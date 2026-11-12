import { Schema } from "effect";

import { AuthUserId } from "./access-token";
import { AuthUser } from "./session";

export const AuthUserKey = Schema.NonEmptyString.pipe(
  Schema.brand("AuthUserKey")
);
export type AuthUserKey = typeof AuthUserKey.Type;
export const AuthUserInput = Schema.Struct({
  email: Schema.NonEmptyString,
  firstName: Schema.optionalKey(Schema.String),
  key: AuthUserKey,
  lastName: Schema.optionalKey(Schema.String),
});
export type AuthUserInput = typeof AuthUserInput.Type;
export const ProvisionedAuthUser = Schema.Struct({
  ...AuthUser.fields,
  id: AuthUserId,
  key: AuthUserKey,
});
export type ProvisionedAuthUser = typeof ProvisionedAuthUser.Type;
