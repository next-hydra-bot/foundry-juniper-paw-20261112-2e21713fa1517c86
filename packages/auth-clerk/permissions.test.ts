import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  PermissionAdapter,
  PermissionCheckFailure,
  Permissions,
} from "@repo/auth-contract/permissions";
import type {
  PermissionContext,
  PermissionGrants,
} from "@repo/auth-contract/permissions";
import { RoleAssignmentsSource } from "@repo/auth-contract/role-assignments";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  ClerkPermissionSession,
  permissionAdapterLayer,
  roleAssignmentsLayer,
} from "./permissions";
import type {
  ClerkPermissionAdapterOptions,
  ClerkPermissionSessionValue,
} from "./permissions";

const alice = AuthUserId.make("alice");
const companyContext: PermissionContext = {
  authUserId: alice,
  scope: { id: "warehouse-east", type: "business-unit" },
};
const organizationContext: PermissionContext = {
  authUserId: alice,
  scope: { id: "org-admin", type: "organization" },
};
const document = {
  grants: [
    { permissions: ["company.members.invite"], scope: companyContext.scope },
    {
      permissions: ["company.orders.viewAll"],
      scope: { id: "warehouse-west", type: "business-unit" },
    },
  ],
  version: 1,
} satisfies PermissionGrants;

const nativeSession: ClerkPermissionSessionValue = {
  claims: { sub: alice },
  has: ({ permission }) => permission === "org:registration:decide",
  organizationId: organizationContext.scope.id,
};

const check = (
  options: ClerkPermissionAdapterOptions,
  session: Effect.Effect<
    ClerkPermissionSessionValue | undefined,
    PermissionCheckFailure
  >,
  context = companyContext,
  permission = "company.members.invite"
) =>
  Permissions.pipe(
    Effect.flatMap((permissions) => permissions.has(permission)),
    Effect.provide(
      Permissions.layer(context).pipe(
        Layer.provide(
          permissionAdapterLayer(options).pipe(
            Layer.provide(
              Layer.succeed(ClerkPermissionSession, { read: session })
            )
          )
        )
      )
    )
  );

describe("Clerk permission adapters", () => {
  it.each(["registration.decide", "registration.read"])(
    "uses the SDK's custom permission check for the active organization: %s",
    async (permission) => {
      await expect(
        Effect.runPromise(
          check(
            { source: "organization" },
            Effect.succeed(nativeSession),
            organizationContext,
            permission
          )
        )
      ).resolves.toBe(permission === "registration.decide");
    }
  );

  it.each([
    { id: "org-other", type: "organization" },
    { id: "org-admin", type: "business-unit" },
  ])(
    "does not check native permissions for another scope: %j",
    async (scope) => {
      let checks = 0;
      await expect(
        Effect.runPromise(
          check(
            { source: "organization" },
            Effect.succeed({
              ...nativeSession,
              has: () => {
                checks += 1;
                return true;
              },
            }),
            { ...organizationContext, scope },
            "registration.decide"
          )
        )
      ).resolves.toBeFalsy();
      expect(checks).toBe(0);
    }
  );

  it("requires an active organization for native permissions", async () => {
    await expect(
      Effect.runPromise(
        check(
          { source: "organization" },
          Effect.succeed({ ...nativeSession, organizationId: undefined }),
          organizationContext,
          "registration.decide"
        )
      )
    ).resolves.toBeFalsy();
  });

  it("supports explicit mappings for domain names with several segments", async () => {
    const options: ClerkPermissionAdapterOptions = {
      permissionMap: new Map([
        ["company.members.invite", "org:registration:decide"],
      ]),
      source: "organization",
    };
    await expect(
      Effect.runPromise(
        check(options, Effect.succeed(nativeSession), organizationContext)
      )
    ).resolves.toBeTruthy();
    await expect(
      Effect.runPromise(
        check(
          options,
          Effect.succeed(nativeSession),
          organizationContext,
          "registration.decide"
        )
      )
    ).resolves.toBeFalsy();
  });

  it("does not invent native keys for unmapped permission names", async () => {
    await expect(
      Effect.runPromise(
        check(
          { source: "organization" },
          Effect.succeed({ ...nativeSession, has: () => true }),
          organizationContext
        )
      )
    ).resolves.toBeFalsy();
  });

  it.each([document, JSON.stringify(document)])(
    "reads scoped metadata without an organization: %j",
    async (app_permissions) => {
      const session = Effect.succeed({
        claims: { app_permissions, sub: alice },
        has: () => false,
      });
      await expect(
        Effect.runPromise(check({ source: "metadata" }, session))
      ).resolves.toBeTruthy();
      await Promise.all(
        [
          { id: "warehouse-west", type: "business-unit" },
          { id: "warehouse-east", type: "organization" },
        ].map(async (scope) => {
          await expect(
            Effect.runPromise(
              check({ source: "metadata" }, session, {
                ...companyContext,
                scope,
              })
            )
          ).resolves.toBeFalsy();
        })
      );
      await expect(
        Effect.runPromise(
          check({ source: "metadata" }, session, companyContext, "company.*")
        )
      ).resolves.toBeFalsy();
    }
  );

  it("never calls the native checker for metadata authority", async () => {
    let nativeChecks = 0;
    await expect(
      Effect.runPromise(
        check(
          { source: "metadata" },
          Effect.succeed({
            ...nativeSession,
            has: () => {
              nativeChecks += 1;
              return true;
            },
          }),
          organizationContext,
          "registration.decide"
        )
      )
    ).resolves.toBeFalsy();
    expect(nativeChecks).toBe(0);
  });

  it("never supplements organization permissions with metadata", async () => {
    await expect(
      Effect.runPromise(
        check(
          { source: "organization" },
          Effect.succeed({
            ...nativeSession,
            claims: {
              app_permissions: {
                grants: [
                  {
                    permissions: ["members.invite"],
                    scope: organizationContext.scope,
                  },
                ],
                version: 1,
              },
              sub: alice,
            },
          }),
          organizationContext,
          "members.invite"
        )
      )
    ).resolves.toBeFalsy();
  });

  it("ignores unrelated malformed metadata in organization mode", async () => {
    await expect(
      Effect.runPromise(
        check(
          { source: "organization" },
          Effect.succeed({
            ...nativeSession,
            claims: { app_permissions: "invalid JSON", sub: alice },
          }),
          organizationContext,
          "registration.decide"
        )
      )
    ).resolves.toBeTruthy();
  });

  it.each(["organization", "metadata"] as const)(
    "denies anonymous %s checks and rejects another subject",
    async (source) => {
      let reads = 0;
      await expect(
        Effect.runPromise(
          check(
            { source },
            Effect.sync(() => {
              reads += 1;
              return undefined;
            })
          )
        )
      ).resolves.toBeFalsy();
      expect(reads).toBe(1);
      await expect(
        Effect.runPromise(
          check(
            { source },
            Effect.succeed({
              ...nativeSession,
              claims: {
                app_permissions: document,
                sub: AuthUserId.make("bob"),
              },
            })
          ).pipe(Effect.flip)
        )
      ).resolves.toMatchObject({ reason: "invalidGrant" });
    }
  );

  it.each([
    "not JSON",
    { grants: [], version: 2 },
    {
      grants: [
        {
          permissions: ["company.members.invite"],
          scope: companyContext.scope,
        },
        { permissions: [], scope: companyContext.scope },
      ],
      version: 1,
    },
  ])(
    "fails closed for malformed or duplicate grants: %j",
    async (app_permissions) => {
      await expect(
        Effect.runPromise(
          check(
            { source: "metadata" },
            Effect.succeed({
              ...nativeSession,
              claims: { app_permissions, sub: alice },
            })
          ).pipe(Effect.flip)
        )
      ).resolves.toMatchObject({ reason: "invalidGrant" });
    }
  );

  it.each([undefined, null])(
    "denies absent metadata: %j",
    async (app_permissions) => {
      await expect(
        Effect.runPromise(
          check(
            { source: "metadata" },
            Effect.succeed({
              ...nativeSession,
              claims: { app_permissions, sub: alice },
            })
          )
        )
      ).resolves.toBeFalsy();
    }
  );

  it("preserves session failures", async () => {
    const failure = new PermissionCheckFailure({
      message: "Session unavailable",
      reason: "unavailable",
    });
    await expect(
      Effect.runPromise(
        check({ source: "metadata" }, Effect.fail(failure)).pipe(Effect.flip)
      )
    ).resolves.toBe(failure);
  });

  it("converts native SDK exceptions to typed failures", async () => {
    await expect(
      Effect.runPromise(
        check(
          { source: "organization" },
          Effect.succeed({
            ...nativeSession,
            has: () => {
              throw new Error("SDK check unavailable");
            },
          }),
          organizationContext,
          "registration.decide"
        ).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "unavailable" });
  });

  it("reads each request lazily instead of capturing the first shopper", async () => {
    let current = nativeSession;
    let reads = 0;
    const adapter = await Effect.runPromise(
      PermissionAdapter.pipe(
        Effect.provide(
          permissionAdapterLayer({ source: "organization" }).pipe(
            Layer.provide(
              Layer.succeed(ClerkPermissionSession, {
                read: Effect.sync(() => {
                  reads += 1;
                  return current;
                }),
              })
            )
          )
        )
      )
    );
    expect(reads).toBe(0);
    await expect(
      Effect.runPromise(adapter.has(organizationContext, "registration.decide"))
    ).resolves.toBeTruthy();
    const bob = AuthUserId.make("bob");
    current = { ...nativeSession, claims: { sub: bob }, has: () => false };
    await expect(
      Effect.runPromise(
        adapter.has(
          { ...organizationContext, authUserId: bob },
          "registration.decide"
        )
      )
    ).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(
        adapter
          .has(organizationContext, "registration.decide")
          .pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "invalidGrant" });
    expect(reads).toBe(3);
  });
});

describe("clerk scoped role claims", () => {
  it("reads only the selected scope of the verified subject", async () => {
    const roles = {
      scopes: {
        "business-unit": {
          "warehouse-east": ["admin"],
          "warehouse-west": ["buyer"],
        },
      },
      version: 1,
    };
    const layer = roleAssignmentsLayer.pipe(
      Layer.provide(
        Layer.succeed(ClerkPermissionSession, {
          read: Effect.succeed({
            claims: { app_roles: roles, sub: alice },
            has: () => false,
          }),
        })
      )
    );
    const read = (context: PermissionContext) =>
      RoleAssignmentsSource.pipe(
        Effect.flatMap((source) => source.get(context)),
        Effect.provide(layer)
      );
    await expect(Effect.runPromise(read(companyContext))).resolves.toEqual([
      "admin",
    ]);
    await expect(
      Effect.runPromise(
        read({
          ...companyContext,
          scope: { type: "business-unit", id: "warehouse-west" },
        })
      )
    ).resolves.toEqual(["buyer"]);
    const failure = await Effect.runPromise(
      read({ ...companyContext, authUserId: AuthUserId.make("bob") }).pipe(
        Effect.flip
      )
    );
    expect(failure.reason).toBe("invalidGrant");
  });
});
