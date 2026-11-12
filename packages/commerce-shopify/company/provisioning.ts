import {
  CommerceAssociateMembership,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import "server-only";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CompanyMemberProvisioning } from "@repo/commerce-core/services/company-member-provisioning";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import {
  claimIdentity as claimCompanyIdentity,
  identityKey,
  IdentityLink,
} from "../customer-account/identity-links";
import {
  ShopifyCompanyAdmin,
  companyMutationResult,
  decodeCompanyResource,
} from "./admin";
import { companyRoleBindings } from "./keys";
import type { CompanyRoleBindings } from "./keys";
import {
  Resource,
  conflict,
  normalize,
  inCompany,
  findCustomer as findCompanyCustomer,
  resolveRoleBinding as resolveStoredRoleBinding,
} from "./resources";

/** Accepts verified invitation identities; email locates resources but does not establish authority. */
export const companyMemberProvisioningLayerWith = (
  bindings: CompanyRoleBindings
) =>
  Layer.effect(
    CompanyMemberProvisioning,
    Effect.gen(function* () {
      const admin = yield* ShopifyCompanyAdmin;
      const identities = yield* VersionedKeyValueStore;
      const findCustomer = (email: string) =>
        findCompanyCustomer(email).pipe(
          Effect.provideService(ShopifyCompanyAdmin, admin)
        );
      const claimIdentity = (link: typeof IdentityLink.Type) =>
        claimCompanyIdentity(link).pipe(
          Effect.provideService(VersionedKeyValueStore, identities)
        );
      const resolveRoleBinding = (
        companyId: string,
        roles: CompanyRoleBindings
      ) =>
        resolveStoredRoleBinding(companyId, roles).pipe(
          Effect.provideService(VersionedKeyValueStore, identities)
        );
      const location = (id: string) =>
        Effect.gen(function* () {
          const data = yield* admin.request(
            `query InvitationCompanyLocation($id:ID!) { companyLocation(id:$id) { id company { id contactRoles(first:250) { nodes { id } pageInfo { hasNextPage } } } } }`,
            { id }
          );
          const resource = yield* decodeCompanyResource(
            Schema.Struct({
              id: Schema.String,
              company: Schema.Struct({
                id: Schema.String,
                contactRoles: Schema.Struct({
                  nodes: Schema.Array(Resource),
                  pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
                }),
              }),
            }),
            data.companyLocation
          );
          const binding = yield* resolveRoleBinding(
            resource.company.id,
            bindings
          );
          if (
            resource.id !== id ||
            !binding ||
            resource.company.contactRoles.pageInfo.hasNextPage ||
            !resource.company.contactRoles.nodes.some(
              ({ id: roleId }) => roleId === binding.buyerRoleId
            )
          ) {
            return yield* new CommerceAccountUnavailable({
              message:
                "Configure a valid buyer role for the selected Shopify company",
            });
          }
          return {
            companyId: resource.company.id,
            buyerRoleId: binding.buyerRoleId,
          };
        });
      return CompanyMemberProvisioning.of({
        canAddMember: ({ businessUnitId, email }) =>
          Effect.gen(function* () {
            const target = yield* location(businessUnitId);
            return inCompany(
              yield* findCustomer(Redacted.value(email)),
              target.companyId
            );
          }).pipe(
            Effect.catchTag("CommerceCustomerEmailConflict", () =>
              Effect.succeed(false)
            )
          ),
        addMember: (input) =>
          Effect.gen(function* () {
            if (input.roles.length !== 1 || input.roles[0] !== "buyer") {
              return yield* new CommerceAccountUnavailable({
                message:
                  "Shopify invitations currently support the Buyer role only",
              });
            }
            const target = yield* location(input.businessUnitId);
            const email = normalize(
              Redacted.value(input.acceptedIdentity.email)
            );
            let customer = yield* findCustomer(email);
            const linked = yield* identities
              .get(
                identityKey("auth", input.acceptedIdentity.authUserId),
                IdentityLink
              )
              .pipe(
                Effect.mapError(
                  () =>
                    new CommerceAccountUnavailable({
                      message: "Shopify identity link is unavailable",
                    })
                )
              );
            if (
              Option.isSome(linked) &&
              (!customer || linked.value.value.customerId !== customer.id)
            ) {
              return yield* conflict();
            }
            if (!inCompany(customer, target.companyId)) {
              return yield* conflict();
            }
            if (!customer) {
              const data = yield* admin.request(
                `mutation InvitationContactCreate($companyId:ID!,$input:CompanyContactInput!) { companyContactCreate(companyId:$companyId,input:$input) { companyContact { id } userErrors { message } } }`,
                {
                  companyId: target.companyId,
                  input: {
                    email,
                    firstName: Redacted.value(input.acceptedIdentity.firstName),
                    lastName: Redacted.value(input.acceptedIdentity.lastName),
                  },
                }
              );
              yield* companyMutationResult(data, "companyContactCreate");
              customer = yield* findCustomer(email);
            }
            if (!customer || !inCompany(customer, target.companyId)) {
              return yield* conflict();
            }
            yield* claimIdentity({
              authUserId: input.acceptedIdentity.authUserId,
              customerId: customer.id,
            });
            let contacts = customer.companyContactProfiles.filter(
              (contact) => contact.company.id === target.companyId
            );
            if (!contacts.length) {
              const data = yield* admin.request(
                `mutation InvitationContactLink($companyId:ID!,$customerId:ID!) { companyAssignCustomerAsContact(companyId:$companyId,customerId:$customerId) { companyContact { id } userErrors { message } } }`,
                { companyId: target.companyId, customerId: customer.id }
              );
              yield* companyMutationResult(
                data,
                "companyAssignCustomerAsContact"
              );
              const refreshed = yield* findCustomer(email);
              if (
                !refreshed ||
                refreshed.id !== customer.id ||
                !inCompany(refreshed, target.companyId)
              ) {
                return yield* conflict();
              }
              contacts = [...refreshed.companyContactProfiles];
            }
            const [contact] = contacts;
            if (
              contacts.length !== 1 ||
              !contact ||
              contact.roleAssignments.pageInfo.hasNextPage
            ) {
              return yield* new CommerceAccountUnavailable({
                message: "Shopify company contact is ambiguous or incomplete",
              });
            }
            // Preserve an existing role rather than downgrading a previously authorized member.
            if (
              !contact.roleAssignments.nodes.some(
                (assignment) =>
                  assignment.companyLocation.id === input.businessUnitId
              )
            ) {
              const data = yield* admin.request(
                `mutation InvitationLocationAssign($contactId:ID!,$locationId:ID!,$roleId:ID!) { companyContactAssignRole(companyContactId:$contactId,companyLocationId:$locationId,companyContactRoleId:$roleId) { companyContactRoleAssignment { id } userErrors { message } } }`,
                {
                  contactId: contact.id,
                  locationId: input.businessUnitId,
                  roleId: target.buyerRoleId,
                }
              );
              yield* companyMutationResult(data, "companyContactAssignRole");
            }
            const verified = yield* findCustomer(email);
            const verifiedContact = verified?.companyContactProfiles.find(
              (candidate) =>
                candidate.id === contact.id &&
                candidate.company.id === target.companyId
            );
            if (
              verified?.id !== customer.id ||
              !verifiedContact ||
              verifiedContact.roleAssignments.pageInfo.hasNextPage ||
              !verifiedContact.roleAssignments.nodes.some(
                (assignment) =>
                  assignment.companyLocation.id === input.businessUnitId
              )
            ) {
              return yield* new CommerceAccountUnavailable({
                message:
                  "Shopify company access could not be confirmed; retry acceptance",
              });
            }
            return new CommerceAssociateMembership({
              authUserId: input.acceptedIdentity.authUserId,
              businessUnitId: input.businessUnitId,
              customerId: CommerceCustomerId.make(customer.id),
              roles: ["buyer"],
            });
          }),
      });
    })
  );
export const companyMemberProvisioningLayer = Layer.suspend(() =>
  companyMemberProvisioningLayerWith(companyRoleBindings())
);
