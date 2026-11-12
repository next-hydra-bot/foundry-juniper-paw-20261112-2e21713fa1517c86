import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import {
  IdentityRoleAssignments,
  makeIdentityRoleAssignments,
} from "@repo/auth-contract/role-assignments";
import { hasTransientTransportCode } from "@repo/errors/transport";
import { Config, Effect, Layer, Redacted, Schema } from "effect";

import type { ClerkPermissionMetadata } from "./permissions";
// The native error object is decoded only to classify retryable HTTP failures.
const isClerkMembershipProjectionUnavailable = (cause: unknown) => {
  const status = Schema.decodeUnknownOption(
    Schema.Struct({ status: Schema.Int })
  )(cause);
  return (
    hasTransientTransportCode(cause) ||
    (status._tag === "Some" &&
      (status.value.status === 408 ||
        status.value.status === 429 ||
        status.value.status >= 500))
  );
};
export interface ClerkRoleAssignmentsPatch {
  readonly version: 1;
  readonly scopes: Readonly<
    Record<string, Readonly<Record<string, readonly string[] | null>> | null>
  >;
}

export interface ClerkUserMetadataApi {
  readonly getUser: (userId: string) => Promise<{
    readonly id: string;
    readonly publicMetadata: ClerkPermissionMetadata;
  }>;
  readonly updateUserMetadata: (
    userId: string,
    input: {
      readonly publicMetadata: {
        readonly application_roles: ClerkRoleAssignmentsPatch;
      };
    }
  ) => Promise<void>;
}

export const makeClerkIdentityRoleAssignments = (users: ClerkUserMetadataApi) =>
  makeIdentityRoleAssignments({
    isNotFound: (cause) =>
      isClerkAPIResponseError(cause) && cause.status === 404,
    isRecoverableFailure: isClerkMembershipProjectionUnavailable,
    read: async (userId) => {
      const user = await users.getUser(userId);
      return { id: user.id, roles: user.publicMetadata.application_roles };
    },
    write: async (userId, roles, previous) => {
      if (Buffer.byteLength(JSON.stringify(roles), "utf-8") > 900) {
        throw new Error(
          "Role assignments exceed the configured session claim budget; use a backend role source."
        );
      }
      // Clerk deep-merges objects: explicitly delete IDs absent from the replacement document.
      const scopes = Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(previous.scopes),
            ...Object.keys(roles.scopes),
          ]),
        ].map((type) => {
          const next = roles.scopes[type];
          if (next === undefined) {
            return [type, null];
          }
          const old = previous.scopes[type] ?? {};
          return [
            type,
            Object.fromEntries(
              [...new Set([...Object.keys(old), ...Object.keys(next)])].map(
                (id) => [
                  id,
                  Object.hasOwn(next, id) ? (next[id] ?? null) : null,
                ]
              )
            ),
          ];
        })
      );
      await users.updateUserMetadata(userId, {
        publicMetadata: { application_roles: { scopes, version: 1 } },
      });
    },
  });

export const identityRoleAssignmentsLayerWith = (users: ClerkUserMetadataApi) =>
  Layer.succeed(
    IdentityRoleAssignments,
    makeClerkIdentityRoleAssignments(users)
  );

export const identityRoleAssignmentsLayer = Layer.effect(
  IdentityRoleAssignments,
  Effect.gen(function* () {
    const secret = yield* Config.schema(
      Schema.RedactedFromValue(Schema.NonEmptyString),
      "CLERK_SECRET_KEY"
    );
    const client = createClerkClient({ secretKey: Redacted.value(secret) });
    return makeClerkIdentityRoleAssignments({
      getUser: async (id) => await client.users.getUser(id),
      updateUserMetadata: async (id, input) => {
        await client.users.updateUserMetadata(id, input);
      },
    });
  })
);
