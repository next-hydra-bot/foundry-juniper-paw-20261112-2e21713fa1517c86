import { Schema } from "effect";

import { PermissionGrant, PermissionScope } from "./permissions";
import { AuthUserKey } from "./user-input";

export const PermissionGrantKey = Schema.NonEmptyString.pipe(
  Schema.brand("PermissionGrantKey")
);
export type PermissionGrantKey = typeof PermissionGrantKey.Type;

/** Stable resource keys are resolved into PermissionScope IDs by the destination. */
export const PermissionGrantInput = Schema.Struct({
  authUserKey: AuthUserKey,
  key: PermissionGrantKey,
  permissions: PermissionGrant.fields.permissions,
  scope: Schema.Struct({
    key: Schema.NonEmptyString,
    type: PermissionScope.fields.type,
  }),
});
export type PermissionGrantInput = typeof PermissionGrantInput.Type;

/** Use the selected realm's composed manifest when publishing an agent input schema. */
export const permissionGrantInputFor = <
  const Permissions extends readonly string[],
>(
  permissions: Permissions
) =>
  Schema.Struct({
    ...PermissionGrantInput.fields,
    permissions: Schema.Array(Schema.Literals(permissions)).check(
      Schema.isUnique()
    ),
  });
