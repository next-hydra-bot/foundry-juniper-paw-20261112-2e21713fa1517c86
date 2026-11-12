import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { planSessionClaims } from "./session-claims-provisioning";

const definitions = [
  {
    metadataKey: "application_roles",
    name: "app_roles",
    replaces: ["app_permissions"],
  },
];

describe("session claim planning", () => {
  it("replaces feature-owned claims while preserving unrelated values", async () => {
    const plan = await Effect.runPromise(
      planSessionClaims(
        { app_permissions: '"old"', locale: '"en"' },
        definitions,
        (key) => key
      )
    );
    expect(plan).toEqual({
      changed: true,
      claims: ["app_roles"],
      next: { app_roles: "application_roles", locale: '"en"' },
      removed: ["app_permissions"],
    });
    await expect(
      Effect.runPromise(planSessionClaims(plan.next, definitions, (key) => key))
    ).resolves.toMatchObject({ changed: false, removed: [] });
  });

  it.each([
    { input: [...definitions, ...definitions] },
    { input: [{ metadataKey: "roles", name: "sub" }] },
    { input: [{ metadataKey: "roles", name: "custom", replaces: ["sid"] }] },
    {
      input: [
        { metadataKey: "roles", name: "custom" },
        { metadataKey: "roles", name: "other", replaces: ["custom"] },
      ],
    },
    { input: [{ metadataKey: "roles }}", name: "custom" }] },
  ])(
    "rejects conflicting or invalid definitions: $input",
    async ({ input }) => {
      await expect(
        Effect.runPromise(planSessionClaims({}, input, (key) => key))
      ).rejects.toThrow(/definitions|reserved/u);
    }
  );
});
