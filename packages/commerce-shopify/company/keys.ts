import { Schema } from "effect";

const id = (type: string) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^gid://shopify/${type}/\\d+$`, "u"))
  );
export const CompanyRoleBindings = Schema.Array(
  Schema.Struct({
    adminRoleIds: Schema.NonEmptyArray(id("CompanyContactRole")),
    buyerRoleId: id("CompanyContactRole"),
    companyId: id("Company"),
  })
);
export type CompanyRoleBindings = typeof CompanyRoleBindings.Type;

/** Native role IDs explicitly define who may invite; display names never authorize. */
export const companyRoleBindings = (): CompanyRoleBindings => {
  const roles = Schema.decodeUnknownSync(
    Schema.fromJsonString(CompanyRoleBindings)
  )(process.env.SHOPIFY_COMPANY_ROLE_BINDINGS ?? "[]");
  if (
    new Set(roles.map((role) => role.companyId)).size !== roles.length ||
    roles.some((role) => role.adminRoleIds.includes(role.buyerRoleId))
  ) {
    throw new Error(
      "Shopify company role bindings must be unique and distinguish buyer and administrator roles"
    );
  }
  return roles;
};

export const RegistrationRoles = Schema.Struct({
  adminRoleIds: Schema.NonEmptyArray(id("CompanyContactRole")),
  buyerRoleId: id("CompanyContactRole"),
});
export type RegistrationRoles = typeof RegistrationRoles.Type;
export const registrationRoles = (): RegistrationRoles | undefined => {
  const value = process.env.SHOPIFY_REGISTRATION_ROLES;
  if (!value) {
    return undefined;
  }
  const roles = Schema.decodeSync(Schema.fromJsonString(RegistrationRoles))(
    value
  );
  if (roles.adminRoleIds.includes(roles.buyerRoleId)) {
    throw new Error("Registration Buyer and administrator roles must differ");
  }
  return roles;
};
