import type { SessionActor } from "@repo/auth-contract/actor";
import { AuthSession, AuthUser } from "@repo/auth-contract/session";
import type { AuthPermissionAdapter } from "@repo/auth-contract/session";
import { Schema } from "effect";

export { AuthSessionReadFailure } from "@repo/auth-contract/session";

export interface ClerkSessionSource {
  readonly actor?: unknown;
  readonly accessToken: string | null;
  readonly organizationId?: string | undefined;
  readonly permissions: AuthPermissionAdapter;
  readonly sessionId: string;
  readonly user: ClerkUserSource | null;
  readonly userId: string;
}

export interface ClerkUserSource {
  readonly email: string | null;
  readonly firstName: string | null;
  readonly id: string;
  readonly imageUrl: string | null;
  readonly lastName: string | null;
}

const domainPermission = /^(?<resource>[^.]+)\.(?<operation>[^.]+)$/u;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Clerk's signed actor payload is decoded at this provider boundary.
export const clerkSessionActor = (value: unknown): SessionActor | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const claims = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.Json)
  )(value);
  const identity = Schema.decodeUnknownSync(
    Schema.Struct({
      reason: Schema.optional(Schema.String),
      sub: Schema.NonEmptyString,
    })
  )(claims);
  return {
    claims,
    provider: "clerk",
    reason: identity.reason,
    subject: identity.sub,
  };
};

export const domainPermissionToClerkPermission = (
  permission: string
): `org:${string}:${string}` | null => {
  const match = domainPermission.exec(permission);

  const resource = match?.groups?.resource;
  const operation = match?.groups?.operation;

  return resource === undefined || operation === undefined
    ? null
    : `org:${resource}:${operation}`;
};

const clerkUserToAuthUser = (
  user: ClerkUserSource | null,
  userId: string
): AuthUser =>
  Schema.decodeSync(AuthUser)({
    email: user?.email ?? null,
    firstName: user?.firstName ?? null,
    id: user?.id ?? userId,
    lastName: user?.lastName ?? null,
    profilePictureUrl: user?.imageUrl ?? null,
  });

export const clerkSessionToAuthSession = (
  session: ClerkSessionSource
): AuthSession => {
  const authSession = {
    actor: clerkSessionActor(session.actor),
    organizationId: session.organizationId,
    permissions: session.permissions,
    sessionId: session.sessionId,
    user: clerkUserToAuthUser(session.user, session.userId),
  };

  return session.accessToken === null
    ? Schema.decodeSync(AuthSession)(authSession)
    : Schema.decodeSync(AuthSession)({
        ...authSession,
        accessToken: session.accessToken,
      });
};
