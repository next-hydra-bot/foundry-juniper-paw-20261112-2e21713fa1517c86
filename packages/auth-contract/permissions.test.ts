import { Effect, Layer } from "effect";
import type { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AuthUserId } from "./access-token";
import {
  accessTokenPermissionAdapterLayer,
  defineAuthorization,
  organizationPermissionsLayer,
  PermissionAdapter,
  PermissionCheckFailure,
  Permissions,
  permissionAdapterFromGrants,
} from "./permissions";
import type {
  PermissionAdapterValue,
  PermissionContext,
  PermissionGrant,
} from "./permissions";

const alice = AuthUserId.make("alice");
const bob = AuthUserId.make("bob");
const context: PermissionContext = {
  authUserId: alice,
  scope: { id: "warehouse-east", type: "business-unit" },
};
const grant: PermissionGrant = {
  ...context,
  permissions: ["company.members.invite", "company.orders.viewAll"],
};

const has = (permission: string) =>
  Permissions.pipe(
    Effect.flatMap((permissions) => permissions.has(permission))
  );

const readWithGrant = (
  resolved: PermissionGrant | undefined,
  permission = "company.members.invite"
) =>
  has(permission).pipe(
    Effect.provide(
      Permissions.layerWith(
        context,
        permissionAdapterFromGrants(() => Effect.succeed(resolved))
      )
    )
  );

describe(Permissions, () => {
  it("uses verified bearer metadata only for its subject and requested company scope", async () => {
    const layer = accessTokenPermissionAdapterLayer({
      authUserId: alice,
      permissionGrants: {
        grants: [
          { permissions: ["company.orders.read"], scope: context.scope },
        ],
        version: 1,
      },
    });
    const check = (scope: PermissionContext) =>
      PermissionAdapter.pipe(
        Effect.flatMap((adapter) => adapter.has(scope, "company.orders.read")),
        Effect.provide(layer)
      );
    await expect(Effect.runPromise(check(context))).resolves.toBeTruthy();
    await expect(
      Effect.runPromise(
        check({ ...context, scope: { id: "other", type: "business-unit" } })
      )
    ).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(
        check({ ...context, authUserId: bob }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "invalidGrant" });
  });

  it("denies missing bearer grants and fails closed on malformed scoped grants", async () => {
    const check = (permissionGrants?: Schema.Json) =>
      PermissionAdapter.pipe(
        Effect.flatMap((adapter) =>
          adapter.has(context, "company.orders.read")
        ),
        Effect.provide(
          accessTokenPermissionAdapterLayer({
            authUserId: alice,
            permissionGrants,
          })
        )
      );
    await expect(Effect.runPromise(check())).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(
        check({
          grants: [
            { permissions: "company.orders.read", scope: context.scope },
          ],
          version: 1,
        }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "invalidGrant" });
  });

  it("accepts its adapter through Effect requirements", async () => {
    const adapterLayer = Layer.succeed(
      PermissionAdapter,
      permissionAdapterFromGrants(() => Effect.succeed(grant))
    );
    const allowed = await Effect.runPromise(
      has("company.members.invite").pipe(
        Effect.provide(
          Permissions.layer(context).pipe(Layer.provide(adapterLayer))
        )
      )
    );

    expect(allowed).toBeTruthy();
  });

  it("passes the bound user, scope and action to a checking adapter", async () => {
    const checks: { context: PermissionContext; permission: string }[] = [];
    const adapter: PermissionAdapterValue = {
      has: (current, permission) =>
        Effect.sync(() => {
          checks.push({ context: current, permission });
          return permission === "company.members.invite";
        }),
    };
    const allowed = await Effect.runPromise(
      has("company.members.invite").pipe(
        Effect.provide(Permissions.layerWith(context, adapter))
      )
    );

    expect(allowed).toBeTruthy();
    expect(checks).toEqual([{ context, permission: "company.members.invite" }]);
  });

  it("defers adapter calls until the check Effect executes", async () => {
    const checks: string[] = [];
    const adapter: PermissionAdapterValue = {
      has: (_, permission) => {
        checks.push(permission);
        return Effect.succeed(true);
      },
    };
    const check = await Effect.runPromise(
      Permissions.pipe(
        Effect.map((permissions) => permissions.has("company.members.invite")),
        Effect.provide(Permissions.layerWith(context, adapter))
      )
    );

    expect(checks).toEqual([]);
    await expect(Effect.runPromise(check)).resolves.toBeTruthy();
    expect(checks).toEqual(["company.members.invite"]);
  });

  it("isolates concurrent users and scopes while sharing the adapter", async () => {
    const adapter = permissionAdapterFromGrants((current) =>
      Effect.succeed(
        current.authUserId === alice && current.scope.id === "warehouse-east"
          ? { ...current, permissions: ["company.members.invite"] }
          : undefined
      )
    );
    const contexts: readonly PermissionContext[] = [
      context,
      { ...context, scope: { id: "warehouse-west", type: "business-unit" } },
      { ...context, authUserId: bob },
    ];
    const allowed = await Effect.runPromise(
      Effect.forEach(
        contexts,
        (current) =>
          has("company.members.invite").pipe(
            Effect.provide(Permissions.layerWith(current, adapter))
          ),
        { concurrency: "unbounded" }
      )
    );

    expect(allowed).toEqual([true, false, false]);
  });

  it("denies every action when explicitly composed without authority", async () => {
    const allowed = await Effect.runPromise(
      has("company.members.invite").pipe(Effect.provide(Permissions.layerNone))
    );

    expect(allowed).toBeFalsy();
  });
});

describe(permissionAdapterFromGrants, () => {
  it("grants exact application permission names without role or namespace conversion", async () => {
    await expect(Effect.runPromise(readWithGrant(grant))).resolves.toBeTruthy();
    await expect(
      Effect.runPromise(readWithGrant(grant, "company.orders.viewAll"))
    ).resolves.toBeTruthy();
    await expect(
      Effect.runPromise(readWithGrant(grant, "company.members.remove"))
    ).resolves.toBeFalsy();
  });

  it("denies missing grants and empty permission sets", async () => {
    await expect(
      Effect.runPromise(readWithGrant(undefined))
    ).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(readWithGrant({ ...grant, permissions: [] }))
    ).resolves.toBeFalsy();
  });

  it("does not infer authority from role names, wildcards or permission prefixes", async () => {
    const unrelated: PermissionGrant = {
      ...context,
      permissions: ["admin", "*", "company.members.*", "company.members"],
    };

    await expect(
      Effect.runPromise(readWithGrant(unrelated))
    ).resolves.toBeFalsy();
  });

  it.each([
    { ...grant, authUserId: bob },
    { ...grant, scope: { ...context.scope, id: "warehouse-west" } },
    { ...grant, scope: { ...context.scope, type: "project" } },
  ])("rejects a grant for another user or scope: %j", async (resolved) => {
    const failure = await Effect.runPromise(
      readWithGrant(resolved).pipe(Effect.flip)
    );

    expect(failure).toBeInstanceOf(PermissionCheckFailure);
    expect(failure.reason).toBe("invalidGrant");
  });

  it("preserves lookup failures instead of reporting an ordinary denial", async () => {
    const unavailable = new PermissionCheckFailure({
      message: "Permission metadata could not be read.",
      reason: "unavailable",
    });
    const failure = await Effect.runPromise(
      has("company.members.invite").pipe(
        Effect.provide(
          Permissions.layerWith(
            context,
            permissionAdapterFromGrants(() => Effect.fail(unavailable))
          )
        ),
        Effect.flip
      )
    );

    expect(failure).toBe(unavailable);
  });

  it("reads the selected scope lazily and observes changes between checks", async () => {
    let current: PermissionGrant | undefined = grant;
    const reads: PermissionContext[] = [];
    const adapter = permissionAdapterFromGrants((requested) =>
      Effect.sync(() => {
        reads.push(requested);
        return current;
      })
    );
    const layer = Permissions.layerWith(context, adapter);

    expect(reads).toEqual([]);
    await expect(
      Effect.runPromise(
        has("company.members.invite").pipe(Effect.provide(layer))
      )
    ).resolves.toBeTruthy();

    current = undefined;
    await expect(
      Effect.runPromise(
        has("company.members.invite").pipe(Effect.provide(layer))
      )
    ).resolves.toBeFalsy();
    expect(reads).toEqual([context, context]);
  });
});

const authorization = defineAuthorization(["review.read", "review.decide"]);
const check = (
  snapshot: Parameters<typeof organizationPermissionsLayer>[0],
  permission: Parameters<typeof authorization.has>[0]
) =>
  authorization
    .has(permission)
    .pipe(Effect.provide(organizationPermissionsLayer(snapshot)));

const organizationSnapshot = {
  authUserId: AuthUserId.make("admin-1"),
  organizationId: "admin-org",
  permissions: {
    has: (permission: string) => permission === "review.read",
  },
};

describe("registration review permissions", () => {
  it("uses the verified Admin organization's native permissions", async () => {
    await expect(
      Effect.runPromise(check(organizationSnapshot, "review.read"))
    ).resolves.toBeTruthy();
    await expect(
      Effect.runPromise(check(organizationSnapshot, "review.decide"))
    ).resolves.toBeFalsy();
  });

  it.each([
    { ...organizationSnapshot, authUserId: undefined },
    { ...organizationSnapshot, organizationId: undefined },
  ])(
    "denies missing identity or organization without calling the checker",
    async (missing) => {
      const result = await Effect.runPromise(
        check(
          {
            ...missing,
            permissions: {
              has: () => {
                throw new Error("Unexpected permission check");
              },
            },
          },
          "review.read"
        )
      );
      expect(result).toBeFalsy();
    }
  );

  it("does not accept a storefront company permission as review authority", async () => {
    const result = await Effect.runPromise(
      check(
        {
          ...organizationSnapshot,
          permissions: {
            has: (permission) => permission === "company.members.invite",
          },
        },
        "review.decide"
      )
    );
    expect(result).toBeFalsy();
  });

  it("reports a failed native permission lookup as unavailable", async () => {
    const error = await Effect.runPromise(
      check(
        {
          ...organizationSnapshot,
          permissions: {
            has: () => {
              throw new Error("SDK unavailable");
            },
          },
        },
        "review.read"
      ).pipe(Effect.flip)
    );
    expect(error).toMatchObject({
      _tag: "PermissionCheckFailure",
      reason: "unavailable",
    });
  });
});
