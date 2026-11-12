import { defineAuthorization } from "../permissions";

export const authorization = defineAuthorization([
  "customer.profile.update",
  "customer.addresses.manage",
] as const);
export const storefrontPermissions = authorization.permissions;
export type StorefrontPermission = (typeof storefrontPermissions)[number];
