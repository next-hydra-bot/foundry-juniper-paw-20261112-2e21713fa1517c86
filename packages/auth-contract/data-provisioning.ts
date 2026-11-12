import type { ConfigProvider } from "effect";
import { Context, Effect, Schema } from "effect";

import type { PermissionGrant } from "./permissions";
import { PermissionGrants } from "./permissions";
import type { IdentityRoleAssignmentsValue } from "./role-assignments";
import type { AuthUserInput, ProvisionedAuthUser } from "./user-input";

export class AuthDataProvisioningFailure extends Schema.TaggedError<AuthDataProvisioningFailure>()(
  "AuthDataProvisioningFailure",
  { message: Schema.String }
) {}
export type RecordAuthProvisioningWrite = (
  operation: "user.create" | "user.update" | "grant.update" | "roles.update",
  userId: string
) => Effect.Effect<void, AuthDataProvisioningFailure>;

/** Storefront administration only. No Organization creation or native Admin grants. */
export interface AuthDataProvisionerValue {
  readonly target: string;
  readonly upsertUser: (
    input: AuthUserInput,
    recordWrite?: RecordAuthProvisioningWrite
  ) => Effect.Effect<ProvisionedAuthUser, AuthDataProvisioningFailure>;
  readonly setGrant: (
    grant: PermissionGrant,
    recordWrite?: RecordAuthProvisioningWrite
  ) => Effect.Effect<PermissionGrant, AuthDataProvisioningFailure>;
  readonly setRoles: (
    assignment: Parameters<IdentityRoleAssignmentsValue["set"]>[0],
    recordWrite?: RecordAuthProvisioningWrite
  ) => Effect.Effect<void, AuthDataProvisioningFailure>;
}
export class AuthDataProvisioner extends Context.Service<
  AuthDataProvisioner,
  {
    readonly prepare: (
      config: ConfigProvider.ConfigProvider
    ) => Effect.Effect<AuthDataProvisionerValue, AuthDataProvisioningFailure>;
  }
>()("@repo/auth-contract/AuthDataProvisioner") {}
/** Replace, initialize or remove one scope, preserving all others. Invalid documents fail closed. */
export const mergePermissionGrant = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the native metadata decoding boundary; the shared schema validates the complete document.
  document: unknown,
  grant: PermissionGrant,
  mode: "replace" | "initialize" | "remove" = "replace"
) =>
  Effect.gen(function* () {
    const current =
      document === undefined || document === null
        ? { grants: [], version: 1 as const }
        : yield* Schema.decodeUnknownEffect(
            Schema.Union([
              PermissionGrants,
              Schema.fromJsonString(PermissionGrants),
            ])
          )(document).pipe(
            Effect.mapError(
              () =>
                new AuthDataProvisioningFailure({
                  message:
                    "Existing application permission metadata is invalid.",
                })
            )
          );
    const identities = new Set<string>();
    for (const item of current.grants) {
      const key = JSON.stringify([item.scope.type, item.scope.id]);
      if (identities.has(key)) {
        return yield* new AuthDataProvisioningFailure({
          message:
            "Existing application permission metadata contains duplicate scopes.",
        });
      }
      identities.add(key);
    }
    if (
      mode === "initialize" &&
      current.grants.some(
        ({ scope }) =>
          scope.type === grant.scope.type && scope.id === grant.scope.id
      )
    ) {
      return current;
    }
    return PermissionGrants.make({
      grants: [
        ...current.grants.filter(
          ({ scope }) =>
            scope.type !== grant.scope.type || scope.id !== grant.scope.id
        ),
        ...(mode === "remove"
          ? []
          : [{ permissions: grant.permissions, scope: grant.scope }]),
      ],
      version: 1,
    });
  });
