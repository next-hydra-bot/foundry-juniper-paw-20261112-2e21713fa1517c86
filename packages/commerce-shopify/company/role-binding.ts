import { createHash } from "node:crypto";

import { VersionedStoreKey } from "@repo/versioned-store";
import { Schema } from "effect";

export const RoleBinding = Schema.Struct({
  adminRoleIds: Schema.Array(Schema.String),
  buyerRoleId: Schema.String,
  companyId: Schema.String,
});
export const roleBindingKey = (companyId: string) =>
  VersionedStoreKey.make(
    `company-roles.${createHash("sha256").update(companyId).digest("hex")}`
  );
