import { createHash } from "node:crypto";

import "server-only";
import {
  CommerceBusinessUnitId,
  CommerceCompanyMember,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import {
  CommerceCompanyMemberships,
  CommerceCompanyMembershipRoster,
  CommerceCompanyMembershipRevision,
  CommerceCompanyMembershipChanged,
  RetainedCommerceCompanyMemberRemoval,
  CommerceCompanyMemberRemainingMembership,
  UnassignedCommerceCompanyMemberRemoval,
} from "@repo/commerce-core/services/commerce-company-memberships";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { identityKey, IdentityLink } from "../customer-account/identity-links";
import {
  ShopifyCompanyAdmin,
  decodeCompanyResource,
  companyMutationResult,
} from "./admin";
import { companyRoleBindings } from "./keys";
import type { CompanyRoleBindings } from "./keys";
import { readCustomer, resolveRoleBinding } from "./resources";
import { companyStorageLayer } from "./storage";

const Assignment = Schema.Struct({
  companyContact: Schema.Struct({
    customer: Schema.Struct({
      defaultEmailAddress: Schema.NullOr(
        Schema.Struct({ emailAddress: Schema.String })
      ),
      firstName: Schema.NullOr(Schema.String),
      id: Schema.String,
      lastName: Schema.NullOr(Schema.String),
    }),
    id: Schema.String,
  }),
  id: Schema.String,
  role: Schema.Struct({ id: Schema.String }),
  updatedAt: Schema.String,
});
const Location = Schema.Struct({
  company: Schema.Struct({ id: Schema.String }),
  id: Schema.String,
  roleAssignments: Schema.Struct({
    nodes: Schema.Array(Assignment),
    pageInfo: Schema.Struct({
      endCursor: Schema.NullOr(Schema.String),
      hasNextPage: Schema.Boolean,
    }),
  }),
});
const unavailable = (message: string) =>
  new CommerceAccountUnavailable({ message });
export const companyMembershipsLayerWith = (bindings: CompanyRoleBindings) =>
  Layer.effect(
    CommerceCompanyMemberships,
    Effect.gen(function* () {
      const admin = yield* ShopifyCompanyAdmin;
      const identities = yield* VersionedKeyValueStore;
      const bindingFor = (companyId: string) =>
        resolveRoleBinding(companyId, bindings).pipe(
          Effect.provideService(VersionedKeyValueStore, identities)
        );
      const read = (businessUnitId: CommerceBusinessUnitId) =>
        Effect.gen(function* () {
          const assignments: (typeof Assignment.Type)[] = [];
          let after: string | null = null;
          let companyId: string | undefined;
          const cursors = new Set<string>();
          while (true) {
            const data: Record<string, Schema.Json> = yield* admin.request(
              `query CompanyMemberRoster($id:ID!,$after:String) { companyLocation(id:$id) { id company { id } roleAssignments(first:100,after:$after) { nodes { id updatedAt role { id } companyContact { id customer { id firstName lastName defaultEmailAddress { emailAddress } } } } pageInfo { hasNextPage endCursor } } } }`,
              { after, id: businessUnitId }
            );
            const location: typeof Location.Type = yield* decodeCompanyResource(
              Location,
              data.companyLocation
            );
            if (
              location.id !== businessUnitId ||
              (companyId !== undefined && companyId !== location.company.id)
            ) {
              return yield* unavailable(
                "Shopify returned another company location"
              );
            }
            companyId = location.company.id;
            assignments.push(...location.roleAssignments.nodes);
            const page = location.roleAssignments.pageInfo;
            if (!page.hasNextPage) {
              break;
            }
            if (!page.endCursor || cursors.has(page.endCursor)) {
              return yield* unavailable(
                "Shopify returned an invalid company roster cursor"
              );
            }
            const cursor: string = page.endCursor;
            cursors.add(cursor);
            after = cursor;
          }
          const binding = yield* bindingFor(companyId);
          if (!binding) {
            return yield* unavailable(
              "Configure native roles before managing company members"
            );
          }
          const groups = new Map<string, (typeof Assignment.Type)[]>();
          for (const assignment of assignments) {
            const { id } = assignment.companyContact.customer;
            const group = groups.get(id) ?? [];
            group.push(assignment);
            groups.set(id, group);
          }
          const members: CommerceCompanyMember[] = [];
          for (const [customerId, rows] of groups) {
            const [first] = rows;
            if (!first) {
              continue;
            }
            const { customer } = first.companyContact;
            if (!customer.defaultEmailAddress) {
              return yield* unavailable(
                "A Shopify company member has no email address"
              );
            }
            const linked = yield* identities
              .get(identityKey("customer", customerId), IdentityLink)
              .pipe(
                Effect.mapError(() =>
                  unavailable("Company member identity is unavailable")
                )
              );
            if (
              Option.isSome(linked) &&
              linked.value.value.customerId !== customerId
            ) {
              return yield* unavailable(
                "Company member identity does not match the native customer"
              );
            }
            const isAdmin = rows.some((row) =>
              binding.adminRoleIds.includes(row.role.id)
            );
            members.push(
              new CommerceCompanyMember({
                authUserId: Option.isSome(linked)
                  ? linked.value.value.authUserId
                  : undefined,
                businessUnitId,
                canRemove: rows.every(
                  (row) => row.role.id === binding.buyerRoleId
                ),
                customerId: CommerceCustomerId.make(customerId),
                directlyAssociated: true,
                email: Redacted.make(
                  customer.defaultEmailAddress.emailAddress,
                  { label: "email" }
                ),
                firstName: customer.firstName
                  ? Redacted.make(customer.firstName, { label: "personName" })
                  : undefined,
                inheritedRoles: [],
                lastName: customer.lastName
                  ? Redacted.make(customer.lastName, { label: "personName" })
                  : undefined,
                roles: isAdmin ? ["admin", "buyer"] : ["buyer"],
              })
            );
          }
          const revision = CommerceCompanyMembershipRevision.make(
            createHash("sha256")
              .update(
                JSON.stringify(
                  assignments
                    .map((row) => [
                      row.id,
                      row.updatedAt,
                      row.role.id,
                      row.companyContact.id,
                      row.companyContact.customer.id,
                    ])
                    // oxlint-disable-next-line unicorn/no-array-sort -- This sorts a newly mapped fingerprint array, never the provider roster.
                    .sort((a, b) =>
                      JSON.stringify(a).localeCompare(JSON.stringify(b))
                    )
                )
              )
              .digest("hex")
          );
          return {
            assignments,
            roster: new CommerceCompanyMembershipRoster({
              businessUnitId,
              members,
              revision,
            }),
          };
        });
      const disposition = (customerId: string) =>
        Effect.gen(function* () {
          const customer = yield* readCustomer(customerId).pipe(
            Effect.provideService(ShopifyCompanyAdmin, admin)
          );
          if (customer) {
            for (const contact of customer.companyContactProfiles) {
              if (contact.roleAssignments.pageInfo.hasNextPage) {
                return yield* unavailable(
                  "Company membership read is incomplete"
                );
              }
              const binding = yield* bindingFor(contact.company.id);
              const [remaining] = contact.roleAssignments.nodes;
              if (remaining) {
                return new RetainedCommerceCompanyMemberRemoval({
                  customerDisposition: "retained",
                  remainingMembership:
                    new CommerceCompanyMemberRemainingMembership({
                      businessUnitId: CommerceBusinessUnitId.make(
                        remaining.companyLocation.id
                      ),
                      roles: binding?.adminRoleIds.includes(remaining.role.id)
                        ? ["admin", "buyer"]
                        : ["buyer"],
                    }),
                });
              }
            }
          }
          return new UnassignedCommerceCompanyMemberRemoval({
            customerDisposition: "unassigned",
          });
        });
      return CommerceCompanyMemberships.of({
        getRoster: (businessUnitId) =>
          read(businessUnitId).pipe(Effect.map((result) => result.roster)),
        removeMember: (input) =>
          Effect.gen(function* () {
            const current = yield* read(input.businessUnitId);
            if (current.roster.revision !== input.expectedRevision) {
              return yield* new CommerceCompanyMembershipChanged({
                businessUnitId: input.businessUnitId,
                message:
                  "Company membership changed; refresh before removing the member",
              });
            }
            const target = current.roster.members.find(
              (member) => member.customerId === input.customerId
            );
            if (!target?.canRemove) {
              return yield* unavailable(
                "Only Buyer access can be removed here; manage administrator or custom roles in Shopify Admin"
              );
            }
            const rows = current.assignments.filter(
              (row) => row.companyContact.customer.id === input.customerId
            );
            for (const row of rows) {
              const data = yield* admin.request(
                `mutation CompanyMemberRevoke($contactId:ID!,$assignmentId:ID!) { companyContactRevokeRole(companyContactId:$contactId,companyContactRoleAssignmentId:$assignmentId) { revokedCompanyContactRoleAssignmentId userErrors { message } } }`,
                { assignmentId: row.id, contactId: row.companyContact.id }
              );
              yield* companyMutationResult(data, "companyContactRevokeRole");
            }
            const verified = yield* read(input.businessUnitId);
            if (
              verified.roster.members.some(
                (member) => member.customerId === input.customerId
              )
            ) {
              return yield* unavailable(
                "Company access removal could not be confirmed; refresh the member list"
              );
            }
            return yield* disposition(input.customerId);
          }),
      });
    })
  );
export const companyMembershipsLayer = Layer.suspend(() =>
  companyMembershipsLayerWith(companyRoleBindings()).pipe(
    Layer.provide(
      companyStorageLayer("identities").pipe(
        Layer.provide(ShopifyCompanyAdmin.layer)
      )
    ),
    Layer.provide(ShopifyCompanyAdmin.layer)
  )
);
