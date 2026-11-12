import {
  AuthSessionAdapter,
  AuthSession,
  AuthUser,
} from "@repo/auth-contract/session";
import { Effect, Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";

import { customerIdentity } from "./identity";

const sessionLayer = (user: AuthUser | null) =>
  Layer.succeed(
    AuthSessionAdapter,
    AuthSessionAdapter.of({
      read: Effect.succeed(
        new AuthSession({ permissions: { has: () => false }, user })
      ),
    })
  );
const user = new AuthUser({
  email: "person@example.com",
  firstName: "Grace",
  id: "authenticated-user",
  lastName: "Hopper",
  profilePictureUrl: null,
});

describe("personal account authentication", () => {
  it("derives the Customer identity from the server session", async () => {
    const identity = await Effect.runPromise(
      customerIdentity.pipe(Effect.provide(sessionLayer(user)))
    );
    expect(identity.authUserId).toBe(user.id);
    expect(Redacted.value(identity.email)).toBe(user.email);
  });

  it("rejects an anonymous registration", async () => {
    const error = await Effect.runPromise(
      customerIdentity.pipe(Effect.provide(sessionLayer(null)), Effect.flip)
    );
    expect(error).toMatchObject({
      _tag: "CustomerAccountUnauthenticated",
      recovery: "reauthenticate",
    });
  });

  it("requires an email from the sign-in account", async () => {
    const error = await Effect.runPromise(
      customerIdentity.pipe(
        Effect.provide(
          sessionLayer(
            new AuthUser({
              email: null,
              firstName: user.firstName,
              id: user.id,
              lastName: user.lastName,
              profilePictureUrl: null,
            })
          )
        ),
        Effect.flip
      )
    );
    expect(error).toMatchObject({
      _tag: "CustomerAccountEmailRequired",
      recovery: "request_access",
    });
  });
});
