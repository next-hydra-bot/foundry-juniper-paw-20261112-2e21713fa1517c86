import {
  CommerceAccountUnavailable,
  CommerceCustomerEmailConflict,
} from "@repo/commerce-core/services/commerce-accounts";
import "server-only";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { Effect, Option, Schema } from "effect";

import { ShopifyCompanyAdmin, decodeCompanyResource } from "./admin";
import type { CompanyRoleBindings } from "./keys";
import { RoleBinding, roleBindingKey } from "./role-binding";

export const Resource = Schema.Struct({ id: Schema.String });
export const Contact = Schema.Struct({
  company: Resource,
  id: Schema.String,
  roleAssignments: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({ companyLocation: Resource, role: Resource })
    ),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  }),
});
export const Customer = Schema.Struct({
  companyContactProfiles: Schema.Array(Contact),
  defaultEmailAddress: Schema.NullOr(
    Schema.Struct({ emailAddress: Schema.String })
  ),
  firstName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  id: Schema.String,
  lastName: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export const customerFields = `id firstName lastName defaultEmailAddress { emailAddress } companyContactProfiles { id company { id } roleAssignments(first:250) { nodes { companyLocation { id } role { id } } pageInfo { hasNextPage } } }`;
export const conflict = () =>
  new CommerceCustomerEmailConflict({
    message: "This customer is already linked to another identity or company",
  });
export const normalize = (email: string) => email.trim().toLowerCase();

export const inCompany = (
  customer: typeof Customer.Type | undefined,
  companyId: string
) =>
  !customer ||
  customer.companyContactProfiles.every(
    (contact) => contact.company.id === companyId
  );

export const findCustomer = (email: string) =>
  Effect.gen(function* () {
    const admin = yield* ShopifyCompanyAdmin;
    const data = yield* admin.request(
      `query InvitationCustomer($query:String!) { customers(first:2,query:$query) { nodes { ${customerFields} } pageInfo { hasNextPage } } }`,
      { query: `email:${JSON.stringify(email)}` }
    );
    const customers = yield* decodeCompanyResource(
      Schema.Struct({
        nodes: Schema.Array(Customer),
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
      }),
      data.customers
    );
    const exact = customers.nodes.filter(
      (customer) =>
        normalize(customer.defaultEmailAddress?.emailAddress ?? "") ===
        normalize(email)
    );
    if (customers.pageInfo.hasNextPage || exact.length > 1) {
      return yield* conflict();
    }
    return exact[0];
  });
export const readCustomer = (id: string) =>
  Effect.gen(function* () {
    const admin = yield* ShopifyCompanyAdmin;
    const data = yield* admin.request(
      `query CompanyCustomer($id:ID!) { customer(id:$id) { ${customerFields} } }`,
      { id }
    );
    const customer = yield* decodeCompanyResource(
      Schema.NullOr(Customer),
      data.customer
    );
    if (customer && customer.id !== id) {
      return yield* new CommerceAccountUnavailable({
        message: "Shopify returned another customer",
      });
    }
    return customer;
  });
export { RoleBinding, roleBindingKey } from "./role-binding";
export const resolveRoleBinding = (
  companyId: string,
  configured: CompanyRoleBindings
) =>
  Effect.gen(function* () {
    const explicit = configured.find(
      (binding) => binding.companyId === companyId
    );
    if (explicit) {
      return explicit;
    }
    const identities = yield* VersionedKeyValueStore;
    const stored = yield* identities
      .get(roleBindingKey(companyId), RoleBinding)
      .pipe(
        Effect.mapError(
          () =>
            new CommerceAccountUnavailable({
              message: "Shopify company roles are unavailable",
            })
        )
      );
    if (Option.isSome(stored) && stored.value.value.companyId !== companyId) {
      return yield* new CommerceAccountUnavailable({
        message: "Shopify company role binding does not match its owner",
      });
    }
    return Option.isSome(stored) ? stored.value.value : undefined;
  });
