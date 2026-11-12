import type { Effect } from "effect";
import { Context, Schema } from "effect";

import { AuthUser } from "./session";

export const AuthUserDetails = Schema.Struct({
  emailVerified: Schema.Boolean,
  user: AuthUser,
});
export type AuthUserDetails = typeof AuthUserDetails.Type;

export class AuthUserLookupFailure extends Schema.TaggedError<AuthUserLookupFailure>()(
  "AuthUserLookupFailure",
  { reason: Schema.Literals(["notFound", "unavailable", "unexpectedResponse"]) }
) {}

/** Read the verified token subject from the selected identity provider, without company onboarding. */
export class AuthUsers extends Context.Service<
  AuthUsers,
  {
    readonly getById: (
      authUserId: string
    ) => Effect.Effect<AuthUserDetails, AuthUserLookupFailure>;
  }
>()("@repo/auth/AuthUsers") {}
