import { defineAuthorization } from "../permissions";

export const authorization = defineAuthorization([] as const);
export const adminPermissions = authorization.permissions;
export type AdminPermission = (typeof adminPermissions)[number];
