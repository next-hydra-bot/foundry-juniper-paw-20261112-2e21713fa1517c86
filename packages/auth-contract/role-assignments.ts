/* oxlint-disable anti-slop/no-unknown-parameters -- These decoders accept native metadata and verified claim documents at the I/O seam. */
import {
  Array as EffectArray,
  Order,
  Context,
  Effect,
  Layer,
  Schema,
} from "effect";

import type { AuthUserId, VerifiedAccessToken } from "./access-token";
import { IdentityMembershipProjectionFailure } from "./identity-memberships";
import { PermissionCheckFailure } from "./permissions";
import type { PermissionContext } from "./permissions";

/** Role assignments belong to a resource scope; their meaning belongs to the installed domain policy. */
export const RoleAssignments = Schema.Struct({
  scopes: Schema.Record(
    Schema.NonEmptyString,
    Schema.Record(
      Schema.NonEmptyString,
      Schema.Array(Schema.NonEmptyString).check(Schema.isUnique())
    )
  ),
  version: Schema.Literal(1),
});
export type RoleAssignments = typeof RoleAssignments.Type;

const Document = Schema.Union([
  RoleAssignments,
  Schema.fromJsonString(RoleAssignments),
]);
export const decodeRoleAssignments = (value: unknown) =>
  value === undefined || value === null
    ? Effect.succeed(RoleAssignments.make({ scopes: {}, version: 1 }))
    : Schema.decodeUnknownEffect(Document)(value);

export const scopedRolesFromDocument = (
  context: PermissionContext,
  value: unknown
) =>
  decodeRoleAssignments(value).pipe(
    Effect.mapError(
      (cause) =>
        new PermissionCheckFailure({
          cause,
          message: "Application role assignments are invalid.",
          reason: "invalidGrant",
        })
    ),
    Effect.map((document) => {
      const scopes = Object.hasOwn(document.scopes, context.scope.type)
        ? document.scopes[context.scope.type]
        : undefined;
      return scopes && Object.hasOwn(scopes, context.scope.id)
        ? (scopes[context.scope.id] ?? [])
        : [];
    })
  );

/** Reads only the verified user's requested scope, never a globally selected company. */
export class RoleAssignmentsSource extends Context.Service<
  RoleAssignmentsSource,
  {
    readonly get: (
      context: PermissionContext
    ) => Effect.Effect<readonly string[], PermissionCheckFailure>;
  }
>()("@repo/auth/RoleAssignmentsSource") {}

export const accessTokenRoleAssignmentsLayer = (
  token: VerifiedAccessToken | undefined
) =>
  Layer.succeed(RoleAssignmentsSource, {
    get: (context) => {
      if (token === undefined) {
        return Effect.succeed([]);
      }
      if (token.authUserId !== context.authUserId) {
        return Effect.fail(
          new PermissionCheckFailure({
            message: "Role assignments belong to another user.",
            reason: "invalidGrant",
          })
        );
      }
      return scopedRolesFromDocument(context, token.roleAssignments);
    },
  });

export class IdentityRoleUserNotFound extends Schema.TaggedError<IdentityRoleUserNotFound>()(
  "IdentityRoleUserNotFound",
  {}
) {}

export interface IdentityRoleAssignmentsValue {
  readonly set: (
    input: PermissionContext & { readonly roles: readonly string[] },
    onWrite?: Effect.Effect<void, IdentityMembershipProjectionFailure>
  ) => Effect.Effect<void, IdentityMembershipProjectionFailure>;
  readonly replace: (input: {
    readonly authUserId: AuthUserId;
    readonly scopeType: string;
    readonly assignments: Readonly<Record<string, readonly string[]>>;
  }) => Effect.Effect<
    void,
    IdentityMembershipProjectionFailure | IdentityRoleUserNotFound
  >;
}

export class IdentityRoleAssignments extends Context.Service<
  IdentityRoleAssignments,
  IdentityRoleAssignmentsValue
>()("@repo/auth/IdentityRoleAssignments") {}

/** Native adapters supply metadata encoding and capacity checks; unrelated metadata is never replaced. */
export const makeIdentityRoleAssignments = (users: {
  readonly read: (
    authUserId: string
  ) => Promise<{ readonly id: string; readonly roles: unknown }>;
  readonly write: (
    authUserId: string,
    roles: RoleAssignments,
    previous: RoleAssignments
  ) => Promise<void>;
  readonly isNotFound?: (cause: unknown) => boolean;
  readonly isRecoverableFailure?: (cause: unknown) => boolean;
}): IdentityRoleAssignmentsValue => {
  const request = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      catch: (cause) =>
        users.isNotFound?.(cause)
          ? new IdentityRoleUserNotFound()
          : new IdentityMembershipProjectionFailure({
              cause,
              message: "Could not synchronize identity role assignments.",
              operation: "project",
              reason: "unavailable",
            }),
      try: run,
    }).pipe(
      Effect.catchTag("IdentityMembershipProjectionFailure", (error) =>
        users.isRecoverableFailure && !users.isRecoverableFailure(error.cause)
          ? Effect.die(error.cause)
          : Effect.fail(error)
      )
    );
  const update = (
    authUserId: AuthUserId,
    modify: (current: RoleAssignments) => RoleAssignments,
    onWrite?: Effect.Effect<void, IdentityMembershipProjectionFailure>
  ) =>
    Effect.gen(function* () {
      const user = yield* request(async () => await users.read(authUserId));
      if (user.id !== authUserId) {
        return yield* Effect.die(
          new Error("Identity role projection returned another user.")
        );
      }
      const [current, next] = yield* decodeRoleAssignments(user.roles).pipe(
        Effect.flatMap((previous) =>
          Schema.decodeEffect(RoleAssignments)(modify(previous)).pipe(
            Effect.map((replacement) => [previous, replacement] as const)
          )
        ),
        Effect.mapError(
          (cause) =>
            new IdentityMembershipProjectionFailure({
              cause,
              message: "Could not decode identity role assignments.",
              operation: "project",
              reason: "unavailable",
            })
        )
      );
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        yield* request(async () => {
          await users.write(authUserId, next, current);
        });
        yield* onWrite ?? Effect.void;
      }
    });
  return {
    replace: ({ authUserId, scopeType, assignments }) =>
      update(authUserId, (current) => ({
        scopes: {
          ...current.scopes,
          [scopeType]: Object.fromEntries(
            EffectArray.sort(
              Object.entries(assignments).filter(
                ([, roles]) => roles.length > 0
              ),
              Order.mapInput(
                Order.String,
                (entry: readonly [string, readonly string[]]) => entry[0]
              )
            ).map(([id, roles]) => [
              id,
              EffectArray.sort([...new Set(roles)], Order.String),
            ])
          ),
        },
        version: 1,
      })),
    set: ({ authUserId, scope, roles }, onWrite) =>
      update(
        authUserId,
        (current) => {
          const entries = Object.entries(
            current.scopes[scope.type] ?? {}
          ).filter(([id]) => id !== scope.id);
          const assignments = Object.fromEntries(
            roles.length === 0
              ? entries
              : [
                  ...entries,
                  [
                    scope.id,
                    EffectArray.sort([...new Set(roles)], Order.String),
                  ],
                ]
          );
          return {
            scopes: { ...current.scopes, [scope.type]: assignments },
            version: 1,
          };
        },
        onWrite
      ).pipe(Effect.catchTag("IdentityRoleUserNotFound", Effect.die)),
  };
};
