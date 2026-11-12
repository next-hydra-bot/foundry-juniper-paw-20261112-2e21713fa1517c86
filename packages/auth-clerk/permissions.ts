import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  PermissionAdapter,
  PermissionCheckFailure,
  permissionGrantFromDocument,
} from "@repo/auth-contract/permissions";
import {
  RoleAssignmentsSource,
  scopedRolesFromDocument,
} from "@repo/auth-contract/role-assignments";
import { Context, Effect, Layer, Schema } from "effect";

import { domainPermissionToClerkPermission } from "./session";

/** Public metadata is an external document; action grants are decoded separately. */
export const ClerkPermissionMetadata = Schema.Record(
  Schema.String,
  Schema.Unknown
);
export type ClerkPermissionMetadata = typeof ClerkPermissionMetadata.Type;

export const CLERK_PERMISSION_METADATA_KEY = "application_permissions";
export const CLERK_PERMISSION_CLAIM = "app_permissions";

/** Decode only claims from a session authenticated by Clerk's server SDK. */
export const ClerkPermissionClaims = Schema.Struct({
  [CLERK_PERMISSION_CLAIM]: Schema.optionalKey(Schema.Json),
  app_roles: Schema.optionalKey(Schema.Json),
  sub: AuthUserId,
});
export type ClerkPermissionClaims = typeof ClerkPermissionClaims.Type;

export type ClerkOrganizationPermission = `org:${string}:${string}`;

export interface ClerkPermissionSessionValue {
  readonly claims: ClerkPermissionClaims;
  readonly has: (check: {
    readonly permission: ClerkOrganizationPermission;
  }) => boolean;
  readonly organizationId?: string;
}

/** Reads the current request; constructing the Layer does not capture a shopper. */
export class ClerkPermissionSession extends Context.Service<
  ClerkPermissionSession,
  {
    readonly read: Effect.Effect<
      ClerkPermissionSessionValue | undefined,
      PermissionCheckFailure
    >;
  }
>()("@repo/auth-clerk/ClerkPermissionSession") {}

const invalidGrant = (message: string, cause?: unknown) =>
  new PermissionCheckFailure({ cause, message, reason: "invalidGrant" });

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- External verified session claims are decoded at this I/O boundary.
export const decodeClerkPermissionClaims = (claims: unknown) =>
  Schema.decodeUnknownEffect(ClerkPermissionClaims)(claims).pipe(
    Effect.mapError((cause) =>
      invalidGrant("Clerk permission claims are invalid.", cause)
    )
  );

export type ClerkPermissionSessionSource =
  | { readonly isAuthenticated: false }
  | {
      readonly has: ClerkPermissionSessionValue["has"];
      readonly isAuthenticated: true;
      readonly orgId?: string | null;
      readonly sessionClaims: unknown;
      readonly userId: string;
    };

export interface ClerkPermissionSessionReader {
  readonly readSession: () => Promise<ClerkPermissionSessionSource>;
}

const unavailable = (cause: unknown) =>
  new PermissionCheckFailure({
    cause,
    message: "The Clerk permission session could not be read or checked.",
    reason: "unavailable",
  });

/** The reader must return Clerk's authenticated SDK result, never client claims. */
export const clerkPermissionSessionLayerWith = ({
  readSession,
}: ClerkPermissionSessionReader) =>
  Layer.succeed(ClerkPermissionSession, {
    read: Effect.gen(function* () {
      const session = yield* Effect.tryPromise({
        catch: unavailable,
        try: readSession,
      });
      if (!session.isAuthenticated) {
        return undefined;
      }
      const claims = yield* decodeClerkPermissionClaims(session.sessionClaims);
      if (claims.sub !== session.userId) {
        return yield* invalidGrant(
          "The Clerk permission claims do not match the authenticated session."
        );
      }
      // Clerk normalizes both compact and legacy organization claims for us.
      return {
        claims,
        has: session.has,
        organizationId: session.orgId ?? undefined,
      };
    }),
  });

export type ClerkPermissionAdapterOptions =
  | { readonly source: "metadata" }
  | {
      /** When supplied, this is the complete domain-to-Clerk permission mapping. */
      readonly permissionMap?: ReadonlyMap<string, ClerkOrganizationPermission>;
      readonly source: "organization";
    };

/** Select one authority source. Metadata never supplements native permissions. */
export const permissionAdapterLayer = (
  options: ClerkPermissionAdapterOptions
) =>
  Layer.effect(
    PermissionAdapter,
    Effect.gen(function* () {
      const session = yield* ClerkPermissionSession;
      return PermissionAdapter.of({
        has: (context, permission) =>
          Effect.gen(function* () {
            const current = yield* session.read;
            if (current === undefined) {
              return false;
            }
            if (current.claims.sub !== context.authUserId) {
              return yield* invalidGrant(
                "The Clerk permission session belongs to another user."
              );
            }
            if (options.source === "metadata") {
              const grant = yield* permissionGrantFromDocument(
                { authUserId: current.claims.sub, scope: context.scope },
                current.claims[CLERK_PERMISSION_CLAIM]
              );
              return grant?.permissions.includes(permission) ?? false;
            }
            if (
              context.scope.type !== "organization" ||
              context.scope.id !== current.organizationId
            ) {
              return false;
            }
            const nativePermission = options.permissionMap
              ? options.permissionMap.get(permission)
              : domainPermissionToClerkPermission(permission);
            if (!nativePermission) {
              return false;
            }
            return yield* Effect.try({
              catch: unavailable,
              try: () => current.has({ permission: nativePermission }),
            });
          }),
      });
    })
  );

export const roleAssignmentsLayer = Layer.effect(
  RoleAssignmentsSource,
  Effect.gen(function* () {
    const session = yield* ClerkPermissionSession;
    return RoleAssignmentsSource.of({
      get: (context) =>
        Effect.gen(function* () {
          const current = yield* session.read;
          if (current === undefined) {
            return [];
          }
          if (current.claims.sub !== context.authUserId) {
            return yield* invalidGrant(
              "Role assignments belong to another user."
            );
          }
          return yield* scopedRolesFromDocument(
            context,
            current.claims.app_roles
          );
        }),
    });
  })
);
