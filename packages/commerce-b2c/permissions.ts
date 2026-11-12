import { defineAuthorization } from "@repo/auth-contract/permissions";

/** Declares supported actions; customer identity and resource ownership still apply. */
export const customerPermissions = [
  "customer.profile.update",
  "customer.addresses.manage",
] as const;

export type CustomerPermission = (typeof customerPermissions)[number];
export const customerAuthorization = defineAuthorization(customerPermissions);
