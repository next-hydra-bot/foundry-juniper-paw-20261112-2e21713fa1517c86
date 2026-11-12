import { AuthUsers } from "@repo/auth-contract/users";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import type { ClerkAuthUser } from "./users";
import { authUsersLayerWith } from "./users";

const user = {
  emailAddresses: [
    {
      emailAddress: "secondary@example.com",
      id: "secondary",
      verification: { status: "verified" },
    },
    {
      emailAddress: "buyer@example.com",
      id: "primary",
      verification: { status: "verified" },
    },
  ],
  firstName: "Buyer",
  id: "user-1",
  imageUrl: "https://example.com/avatar.png",
  lastName: null,
  primaryEmailAddressId: "primary",
};
const read = (value: ClerkAuthUser) =>
  AuthUsers.pipe(
    Effect.flatMap((users) => users.getById("user-1")),
    Effect.provide(authUsersLayerWith(async () => await Promise.resolve(value)))
  );
describe("Clerk authenticated user lookup", () => {
  it("reads the exact verified primary email of the authenticated subject", async () => {
    await expect(Effect.runPromise(read(user))).resolves.toMatchObject({
      emailVerified: true,
      user: { email: "buyer@example.com", id: "user-1" },
    });
  });

  it("does not fall back to another verified email when the primary email is unverified", async () => {
    const details = await Effect.runPromise(
      read({
        ...user,
        emailAddresses: user.emailAddresses.map((email) =>
          email.id === "primary"
            ? { ...email, verification: { status: "unverified" } }
            : email
        ),
      })
    );
    expect(details.emailVerified).toBeFalsy();
  });

  it("rejects a response identifying a different user", async () => {
    await expect(
      Effect.runPromise(read({ ...user, id: "user-2" }).pipe(Effect.flip))
    ).resolves.toMatchObject({ reason: "unexpectedResponse" });
  });
});
