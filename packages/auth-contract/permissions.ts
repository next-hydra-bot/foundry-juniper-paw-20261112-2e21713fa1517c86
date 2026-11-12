/* oxlint-disable max-classes-per-file -- The permission capability and its typed adapter failure define one authorization interface. */
import { Context, Effect, Layer, Schema } from "effect";

import { AuthUserId } from "./access-token";
import type { VerifiedAccessToken } from "./access-token";
import type { AuthPermissionAdapter } from "./session";

/** Resource identity, independent of auth Organizations and provider ID formats. */
export const PermissionScope = Schema.Struct({
  id: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
});
export type PermissionScope = typeof PermissionScope.Type;

/** Construct from verified server identity and resource access, never form claims. */
export const PermissionContext = Schema.Struct({
  authUserId: AuthUserId,
  scope: PermissionScope,
});
export type PermissionContext = typeof PermissionContext.Type;

/** Normalized grant for one user and scope; adapters own metadata/claim decoding. */
export const PermissionGrant = Schema.Struct({
  ...PermissionContext.fields,
  permissions: Schema.Array(Schema.NonEmptyString).check(Schema.isUnique()),
});
export type PermissionGrant = typeof PermissionGrant.Type;

/** User identity comes from the verified session or token containing this data. */
export const PermissionGrants = Schema.Struct({
  grants: Schema.Array(
    Schema.Struct({
      permissions: PermissionGrant.fields.permissions,
      scope: PermissionScope,
    })
  ),
  version: Schema.Literal(1),
});
export type PermissionGrants = typeof PermissionGrants.Type;

export class PermissionCheckFailure extends Schema.TaggedError<PermissionCheckFailure>()(
  "PermissionCheckFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    reason: Schema.Literals(["unavailable", "invalidGrant"]),
  }
) {}

const PermissionGrantsDocument = Schema.Union([
  PermissionGrants,
  Schema.fromJsonString(PermissionGrants),
]);

/** Read a scoped grant from a document belonging to the verified context's user. */
export const permissionGrantFromDocument = (
  context: PermissionContext,
  value: Schema.Json | undefined
): Effect.Effect<PermissionGrant | undefined, PermissionCheckFailure> =>
  Effect.gen(function* () {
    if (value === undefined || value === null) {
      return undefined;
    }
    const document = yield* Schema.decodeUnknownEffect(
      PermissionGrantsDocument
    )(value).pipe(
      Effect.mapError(
        (cause) =>
          new PermissionCheckFailure({
            cause,
            message: "Application permission grants are invalid.",
            reason: "invalidGrant",
          })
      )
    );
    const matches = document.grants.filter(
      ({ scope }) =>
        scope.id === context.scope.id && scope.type === context.scope.type
    );
    if (matches.length > 1) {
      return yield* new PermissionCheckFailure({
        message:
          "Application permissions contain duplicate grants for this scope.",
        reason: "invalidGrant",
      });
    }
    const [grant] = matches;
    return grant === undefined
      ? undefined
      : { ...grant, authUserId: context.authUserId };
  });

/** Implementations capture their dependencies when constructed. */
export interface PermissionAdapterValue {
  readonly has: (
    context: PermissionContext,
    permission: string
  ) => Effect.Effect<boolean, PermissionCheckFailure>;
}

/** The host supplies an organization-, metadata-, or other policy-backed adapter. */
export class PermissionAdapter extends Context.Service<
  PermissionAdapter,
  PermissionAdapterValue
>()("@repo/auth/PermissionAdapter") {}

export type ResolvePermissionGrant = (
  context: PermissionContext
) => Effect.Effect<PermissionGrant | undefined, PermissionCheckFailure>;

/** Resolves only the requested user's scope. Missing grants deny; failed reads fail. */
export const permissionAdapterFromGrants = (
  resolve: ResolvePermissionGrant
): PermissionAdapterValue => ({
  has: (context, permission) =>
    Effect.gen(function* () {
      const grant = yield* resolve(context);
      if (grant === undefined) {
        return false;
      }
      if (
        grant.authUserId !== context.authUserId ||
        grant.scope.type !== context.scope.type ||
        grant.scope.id !== context.scope.id
      ) {
        return yield* new PermissionCheckFailure({
          message:
            "The permission grant does not match the requested user and scope.",
          reason: "invalidGrant",
        });
      }
      return grant.permissions.includes(permission);
    }),
});

/** Request-bound authorization. Share adapters, not the selected user/scope. */
export class Permissions extends Context.Service<
  Permissions,
  {
    readonly has: (
      permission: string
    ) => Effect.Effect<boolean, PermissionCheckFailure>;
  }
>()("@repo/auth/Permissions") {
  static readonly layer = ({
    authUserId,
    scope: { id, type },
  }: PermissionContext) =>
    Layer.effect(
      Permissions,
      Effect.gen(function* () {
        const adapter = yield* PermissionAdapter;
        return Permissions.of({
          has: (permission) =>
            Effect.suspend(() =>
              adapter.has({ authUserId, scope: { id, type } }, permission)
            ),
        });
      })
    );

  static readonly layerWith = (
    context: PermissionContext,
    adapter: PermissionAdapterValue
  ) =>
    Permissions.layer(context).pipe(
      Layer.provide(Layer.succeed(PermissionAdapter, adapter))
    );

  /** Explicitly supplies no authority, for example for an anonymous request. */
  static readonly layerNone = Layer.succeed(
    Permissions,
    Permissions.of({ has: () => Effect.succeed(false) })
  );
}

/** Bridge native permission checks from an already verified session or bearer token. */
export const organizationPermissionsLayer = (snapshot: {
  readonly authUserId: AuthUserId | undefined;
  readonly organizationId?: string | undefined;
  readonly permissions: AuthPermissionAdapter;
}) => {
  const { authUserId, organizationId, permissions } = snapshot;
  if (authUserId === undefined || organizationId === undefined) {
    return Permissions.layerNone;
  }
  return Permissions.layerWith(
    { authUserId, scope: { id: organizationId, type: "organization" } },
    {
      has: (context, permission) =>
        Effect.try({
          catch: (cause) =>
            new PermissionCheckFailure({
              cause,
              message: "Organization permissions could not be checked.",
              reason: "unavailable",
            }),
          try: () =>
            context.authUserId === authUserId &&
            context.scope.type === "organization" &&
            context.scope.id === organizationId &&
            permissions.has(permission),
        }),
    }
  );
};

/** Feature definitions supply the vocabulary; the request's Permissions supplies authority. */
export const defineAuthorization = <const Permission extends string = never>(
  ...definitions: readonly (readonly Permission[])[]
) => {
  const declared = new Set(definitions.flat());
  return {
    has: (
      permission: Permission
    ): Effect.Effect<boolean, PermissionCheckFailure, Permissions> =>
      Effect.suspend(() =>
        declared.has(permission)
          ? Permissions.pipe(
              Effect.flatMap((permissions) => permissions.has(permission))
            )
          : Effect.succeed(false)
      ),
    permissions: Object.freeze([...declared]),
  };
};

/** Metadata authority for a verified bearer request; never reads browser cookies or Organizations. */
export const accessTokenPermissionAdapterLayer = (
  token:
    | Pick<VerifiedAccessToken, "authUserId" | "permissionGrants">
    | undefined
) =>
  Layer.succeed(
    PermissionAdapter,
    permissionAdapterFromGrants((context) => {
      if (token !== undefined && context.authUserId !== token.authUserId) {
        return Effect.fail(
          new PermissionCheckFailure({
            message:
              "The permission subject does not match the verified bearer token.",
            reason: "invalidGrant",
          })
        );
      }
      return permissionGrantFromDocument(context, token?.permissionGrants);
    })
  );
