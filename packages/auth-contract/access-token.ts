/* oxlint-disable max-classes-per-file, unicorn/throw-new-error -- The token DTO, typed errors, and verifier service form one public auth contract. */
import { Context, Effect, Schema } from "effect";

import { SessionActor } from "./actor";
import { AuthPermissionAdapterSchema } from "./session";
import type { AuthPermissionAdapter } from "./session";

export const AuthUserId = Schema.NonEmptyString.pipe(
  Schema.brand("AuthUserId")
);
export type AuthUserId = typeof AuthUserId.Type;

const noPermissions: AuthPermissionAdapter = {
  has: () => false,
};

export const authPermissionsFrom = (
  permissions: Iterable<string>
): AuthPermissionAdapter => {
  const grantedPermissions = new Set(permissions);

  return {
    has: (permission) => grantedPermissions.has(permission),
  };
};

export class VerifiedAccessToken extends Schema.Class<VerifiedAccessToken>(
  "VerifiedAccessToken"
)({
  actor: Schema.optional(SessionActor),
  authUserId: AuthUserId,
  organizationId: Schema.optional(Schema.NonEmptyString),
  /** Application grants copied only from authenticated token claims. */
  permissionGrants: Schema.optional(Schema.Json),
  /** Scoped roles copied only from authenticated token claims. */
  roleAssignments: Schema.optional(Schema.Json),
  permissions: AuthPermissionAdapterSchema.pipe(
    Schema.withConstructorDefault(Effect.succeed(noPermissions))
  ),
  sessionId: Schema.optional(Schema.NonEmptyString),
}) {}

export class AccessTokenInvalid extends Schema.TaggedError<AccessTokenInvalid>()(
  "AccessTokenInvalid",
  {
    message: Schema.String,
    reason: Schema.Literals([
      "invalidToken",
      "invalidClaims",
      "invalidIssuer",
      "invalidAudience",
      "missingRequiredPermission",
    ]),
  }
) {}

export class AccessTokenVerificationFailure extends Schema.TaggedError<AccessTokenVerificationFailure>()(
  "AccessTokenVerificationFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    reason: Schema.Literals(["unavailable", "unexpected"]),
  }
) {}

export class AccessTokenVerifier extends Context.Service<
  AccessTokenVerifier,
  {
    readonly verify: (
      token: string
    ) => Effect.Effect<
      VerifiedAccessToken,
      AccessTokenInvalid | AccessTokenVerificationFailure
    >;
  }
>()("@repo/auth/AccessTokenVerifier") {
  static readonly verify = Effect.fn("AccessTokenVerifier.verify")(
    (token: string) =>
      AccessTokenVerifier.pipe(
        Effect.flatMap((verifier) => verifier.verify(token))
      )
  );
}

export const validateRequiredAccessTokenPermissions = Effect.fn(
  "validateRequiredAccessTokenPermissions"
)(function* (
  token: VerifiedAccessToken,
  requiredPermissions: readonly string[]
) {
  const missingPermission = requiredPermissions.find(
    (permission) => !token.permissions.has(permission)
  );

  if (missingPermission !== undefined) {
    return yield* new AccessTokenInvalid({
      message: `Access token is missing required permission ${missingPermission}`,
      reason: "missingRequiredPermission",
    });
  }

  return token;
});
