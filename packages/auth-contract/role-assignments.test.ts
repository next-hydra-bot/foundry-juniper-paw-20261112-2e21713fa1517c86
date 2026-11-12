import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { AuthUserId } from "./access-token";
/* oxlint-disable eslint/require-await -- Metadata SDK doubles retain asynchronous method signatures. */
import type { RoleAssignments } from "./role-assignments";
import {
  makeIdentityRoleAssignments,
  scopedRolesFromDocument,
} from "./role-assignments";

describe("Scoped role assignments", () => {
  it("updates one Business Unit, removes another and preserves unrelated scopes", async () => {
    let roles: RoleAssignments = {
      scopes: {
        "business-unit": { acme: ["admin"], beta: ["buyer"] },
        project: { docs: ["editor"] },
      },
      version: 1,
    };
    const writer = makeIdentityRoleAssignments({
      read: async (id) => ({ id, roles }),
      write: async (_id, next) => {
        roles = next;
      },
    });
    const context = {
      authUserId: AuthUserId.make("user-a"),
      scope: { id: "acme", type: "business-unit" },
    };
    await Effect.runPromise(writer.set({ ...context, roles: ["buyer"] }));
    await expect(
      Effect.runPromise(scopedRolesFromDocument(context, roles))
    ).resolves.toEqual(["buyer"]);
    await Effect.runPromise(
      writer.set({
        ...context,
        roles: [],
        scope: { id: "beta", type: "business-unit" },
      })
    );
    expect(roles).toEqual({
      scopes: {
        "business-unit": { acme: ["buyer"] },
        project: { docs: ["editor"] },
      },
      version: 1,
    });
    await Effect.runPromise(
      writer.replace({
        assignments: {},
        authUserId: context.authUserId,
        scopeType: "business-unit",
      })
    );
    expect(roles).toEqual({
      scopes: { "business-unit": {}, project: { docs: ["editor"] } },
      version: 1,
    });
  });

  it("rejects malformed metadata before writing and verifies the identity returned by the provider", async () => {
    let writes = 0;
    const writer = makeIdentityRoleAssignments({
      read: async () => ({ id: "another-user", roles: {} }),
      write: async () => {
        writes += 1;
      },
    });
    await expect(
      Effect.runPromise(
        writer.replace({
          assignments: {},
          authUserId: AuthUserId.make("user-a"),
          scopeType: "business-unit",
        })
      )
    ).rejects.toThrow("Identity role projection returned another user.");
    const failure = await Effect.runPromise(
      scopedRolesFromDocument(
        {
          authUserId: AuthUserId.make("user-a"),
          scope: { id: "acme", type: "business-unit" },
        },
        { scopes: {}, version: 2 }
      ).pipe(Effect.flip)
    );
    expect(failure.reason).toBe("invalidGrant");
    expect(writes).toBe(0);
  });
});
