import { permissionGrantInputFor } from "../permission-grant-input";
import { storefrontPermissions } from "../permissions/storefront";
import { AuthUserInput } from "../user-input";

export const authInputModels = {
  "auth-users": AuthUserInput,
  "permission-grants": permissionGrantInputFor(storefrontPermissions),
} as const;
