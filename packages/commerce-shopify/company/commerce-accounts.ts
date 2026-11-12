import { createHash } from "node:crypto";

import "server-only";
import {
  CommerceAccount,
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceBusinessUnitLabel,
  CommerceBusinessUnitMembership,
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import {
  CommerceAccounts,
  CommerceAccountUnavailable,
  CommerceCustomerIdNotFound,
  CommerceCustomerProfileNotFound,
} from "@repo/commerce-core/services/commerce-accounts";
import type {
  CommerceAccountRegistrationInput,
  LinkRegistrantIdentityInput,
} from "@repo/commerce-core/services/commerce-accounts";
import { CompanyMemberProvisioning } from "@repo/commerce-core/services/company-member-provisioning";
import { CompanyRegistrationEligibility } from "@repo/commerce-core/services/company-registration-eligibility";
import {
  VersionedKeyValueStore,
  VersionedStoreKey,
} from "@repo/versioned-store";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import {
  claimIdentity,
  identityKey,
  IdentityLink,
} from "../customer-account/identity-links";
import {
  ShopifyCompanyAdmin,
  decodeCompanyResource,
  companyMutationResult,
} from "./admin";
import { companyRoleBindings, registrationRoles } from "./keys";
import type { CompanyRoleBindings, RegistrationRoles } from "./keys";
import { companyMemberProvisioningLayerWith } from "./provisioning";
import { companyPurchasingPoliciesLayer } from "./purchasing-policies";
import {
  findCustomer,
  readCustomer,
  RoleBinding,
  roleBindingKey,
  resolveRoleBinding,
  normalize,
} from "./resources";
import { companyStorageLayer } from "./storage";

const Page = Schema.Struct({ hasNextPage: Schema.Boolean });
const Company = Schema.Struct({
  contactRoles: Schema.Struct({
    nodes: Schema.Array(Schema.Struct({ id: Schema.String })),
    pageInfo: Page,
  }),
  externalId: Schema.NullOr(Schema.String),
  id: Schema.String,
  locations: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        externalId: Schema.NullOr(Schema.String),
        id: Schema.String,
      })
    ),
    pageInfo: Page,
  }),
});
const companyFields =
  "id externalId locations(first:2) { nodes { id externalId } pageInfo { hasNextPage } } contactRoles(first:250) { nodes { id } pageInfo { hasNextPage } }";
type RegistrationLocationInput = {
  externalId: string;
  name: string;
  shippingAddress: {
    address1: string;
    address2: string | null;
    city: string;
    zip: string;
    countryCode: string;
    zoneCode: string | null;
  };
  billingSameAsShipping: boolean;
  taxRegistrationId?: string;
  phone?: string;
};
type CompanyCreateRequest = {
  company: { name: string; externalId: string };
  companyLocation: RegistrationLocationInput;
  companyContact?: { email: string; firstName: string; lastName: string };
};
const Creation = Schema.Struct({
  account: Schema.optional(CommerceAccount),
  fingerprint: Schema.String,
});
const unavailable = (message: string) =>
  new CommerceAccountUnavailable({ message });
const externalId = (registrationId: string) =>
  `registration-${createHash("sha256").update(registrationId).digest("hex")}`;

export const commerceAccountsLayerWith = (
  bindings: CompanyRoleBindings,
  roles: RegistrationRoles | undefined
) =>
  Layer.effect(
    CommerceAccounts,
    Effect.gen(function* () {
      const admin = yield* ShopifyCompanyAdmin;
      const store = yield* VersionedKeyValueStore;
      const members = yield* CompanyMemberProvisioning;
      const provide = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        program.pipe(
          Effect.provideService(ShopifyCompanyAdmin, admin),
          Effect.provideService(VersionedKeyValueStore, store)
        );
      const resolveCustomer = (authUserId: string) =>
        Effect.gen(function* () {
          const link = yield* store.get(
            identityKey("auth", authUserId),
            IdentityLink
          );
          return Option.isSome(link)
            ? yield* provide(readCustomer(link.value.value.customerId))
            : null;
        }).pipe(
          Effect.mapError(() =>
            unavailable("Shopify customer identity is unavailable")
          )
        );
      const nativeMemberships = (
        customer: NonNullable<Effect.Success<ReturnType<typeof readCustomer>>>
      ) =>
        Effect.gen(function* () {
          const memberships: CommerceBusinessUnitMembership[] = [];
          for (const contact of customer.companyContactProfiles) {
            if (contact.roleAssignments.pageInfo.hasNextPage) {
              return yield* unavailable(
                "Shopify membership read is incomplete"
              );
            }
            const binding = yield* provide(
              resolveRoleBinding(contact.company.id, bindings)
            );
            for (const assignment of contact.roleAssignments.nodes) {
              const { id } = assignment.companyLocation;
              memberships.push(
                new CommerceBusinessUnitMembership({
                  businessUnitId: CommerceBusinessUnitId.make(id),
                  businessUnitKey: CommerceBusinessUnitKey.make(id),
                  businessUnitLabel: CommerceBusinessUnitLabel.make(id),
                  roles: binding?.adminRoleIds.includes(assignment.role.id)
                    ? ["admin", "buyer"]
                    : ["buyer"],
                })
              );
            }
          }
          return memberships;
        });
      const create = (registration: CommerceAccountRegistrationInput) =>
        Effect.gen(function* () {
          if (registration._tag !== "ApprovedRegistration") {
            return yield* unavailable(
              "Only approved registrations can provision a company"
            );
          }
          if (!roles) {
            return yield* unavailable(
              "Configure Shopify registration Buyer and administrator role IDs before onboarding"
            );
          }
          const key = VersionedStoreKey.make(
            `registration-account.${registration.id}`
          );
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                address: {
                  address2: registration.details.address.additionalStreetInfo
                    ? Redacted.value(
                        registration.details.address.additionalStreetInfo
                      )
                    : null,
                  city: Redacted.value(registration.details.address.city),
                  country: registration.details.address.country,
                  postalCode: Redacted.value(
                    registration.details.address.postalCode
                  ),
                  region: registration.details.address.region
                    ? Redacted.value(registration.details.address.region)
                    : null,
                  street: Redacted.value(
                    registration.details.address.streetName
                  ),
                },
                company: registration.details.companyName,
                email: normalize(Redacted.value(registration.details.email)),
                firstName: Redacted.value(
                  registration.details.contactFirstName
                ),
                lastName: Redacted.value(registration.details.contactLastName),
                phone: registration.details.companyPhone
                  ? Redacted.value(registration.details.companyPhone)
                  : null,
                storeKey: registration.storeKey,
                vatId: registration.details.vatId
                  ? Redacted.value(registration.details.vatId)
                  : null,
              })
            )
            .digest("hex");
          const existing = yield* store.get(key, Creation);
          if (
            Option.isSome(existing) &&
            existing.value.value.fingerprint !== fingerprint
          ) {
            return yield* unavailable(
              "Registration provisioning inputs changed; reconcile the existing company"
            );
          }
          if (Option.isSome(existing) && existing.value.value.account) {
            return existing.value.value.account;
          }
          const email = normalize(Redacted.value(registration.details.email));
          let customer = yield* provide(findCustomer(email));
          if (
            Option.isNone(existing) &&
            (customer?.companyContactProfiles.length ?? 0) > 0
          ) {
            return yield* unavailable(
              "This Shopify customer already belongs to a company"
            );
          }
          const reference = externalId(registration.id);
          let company: typeof Company.Type;
          if (Option.isSome(existing)) {
            const result = yield* admin.request(
              `query RegisteredCompanyRecovery($query:String!) { companies(first:2,query:$query) { nodes { ${companyFields} } pageInfo { hasNextPage } } }`,
              { query: `external_id:${JSON.stringify(reference)}` }
            );
            const found = yield* decodeCompanyResource(
              Schema.Struct({ nodes: Schema.Array(Company), pageInfo: Page }),
              result.companies
            );
            const exact = found.nodes.filter(
              (candidate) => candidate.externalId === reference
            );
            const [matched] = exact;
            if (found.pageInfo.hasNextPage || exact.length !== 1 || !matched) {
              return yield* unavailable(
                "Company creation outcome is uncertain; reconcile it in Shopify before retrying"
              );
            }
            company = matched;
          } else {
            yield* store.insert(key, Creation, { fingerprint });
            const { address } = registration.details;
            const location: RegistrationLocationInput = {
              billingSameAsShipping: true,
              externalId: reference,
              name: registration.details.companyName,
              shippingAddress: {
                address1: Redacted.value(address.streetName),
                address2: address.additionalStreetInfo
                  ? Redacted.value(address.additionalStreetInfo)
                  : null,
                city: Redacted.value(address.city),
                countryCode: address.country,
                zip: Redacted.value(address.postalCode),
                zoneCode: address.region
                  ? Redacted.value(address.region)
                  : null,
              },
            };
            if (registration.details.vatId) {
              location.taxRegistrationId = Redacted.value(
                registration.details.vatId
              );
            }
            if (registration.details.companyPhone) {
              location.phone = Redacted.value(
                registration.details.companyPhone
              );
            }
            const input: CompanyCreateRequest = {
              company: {
                externalId: reference,
                name: registration.details.companyName,
              },
              companyLocation: location,
            };
            if (!customer) {
              input.companyContact = {
                email,
                firstName: Redacted.value(
                  registration.details.contactFirstName
                ),
                lastName: Redacted.value(registration.details.contactLastName),
              };
            }
            const result = yield* admin.request(
              `mutation RegistrationCompanyCreate($input:CompanyCreateInput!) { companyCreate(input:$input) { company { ${companyFields} } userErrors { message } } }`,
              { input }
            );
            const outcome = yield* decodeCompanyResource(
              Schema.Struct({
                company: Schema.NullOr(Company),
                userErrors: Schema.Array(
                  Schema.Struct({ message: Schema.String })
                ),
              }),
              result.companyCreate
            );
            if (outcome.userErrors.length > 0 && outcome.company === null) {
              const rejected = yield* store.get(key, Creation);
              if (Option.isSome(rejected)) {
                yield* store.remove(key, rejected.value);
              }
              return yield* unavailable(
                "Shopify rejected company creation; correct the configuration before retrying"
              );
            }
            const payload = yield* companyMutationResult(
              result,
              "companyCreate"
            );
            company = yield* decodeCompanyResource(Company, payload.company);
          }
          const locations = company.locations.nodes.filter(
            (location) => location.externalId === reference
          );
          if (
            company.externalId !== reference ||
            company.locations.pageInfo.hasNextPage ||
            company.contactRoles.pageInfo.hasNextPage ||
            locations.length !== 1 ||
            !locations[0]
          ) {
            return yield* unavailable(
              "Created Shopify company does not match the registration"
            );
          }
          const nativeRoles = new Set(
            company.contactRoles.nodes.map((role) => role.id)
          );
          if (
            !nativeRoles.has(roles.buyerRoleId) ||
            roles.adminRoleIds.some((id) => !nativeRoles.has(id))
          ) {
            return yield* unavailable(
              "Registration role IDs are not valid for the created company"
            );
          }
          const binding = { ...roles, companyId: company.id };
          const bindingKey = roleBindingKey(company.id);
          const priorBinding = yield* store.get(bindingKey, RoleBinding);
          if (Option.isNone(priorBinding)) {
            yield* store.insert(bindingKey, RoleBinding, binding);
          }
          customer = yield* provide(findCustomer(email));
          if (!customer) {
            return yield* unavailable(
              "Created Shopify customer could not be confirmed; retry onboarding"
            );
          }
          const account = new CommerceAccount({
            businessUnitId: CommerceBusinessUnitId.make(locations[0].id),
            customerId: CommerceCustomerId.make(customer.id),
            registrationId: registration.id,
          });
          const reserved = yield* store.get(key, Creation);
          if (Option.isNone(reserved)) {
            return yield* unavailable(
              "Company provisioning reservation is missing"
            );
          }
          yield* store.update(key, Creation, reserved.value, {
            account,
            fingerprint,
          });
          return account;
        }).pipe(
          Effect.mapError((error) =>
            error._tag === "CommerceAccountUnavailable"
              ? error
              : unavailable(
                  "Shopify company provisioning could not be completed; retry to reconcile its state"
                )
          )
        );
      const link = (input: LinkRegistrantIdentityInput) =>
        Effect.gen(function* () {
          const customer = yield* provide(
            readCustomer(input.commerceAccount.customerId)
          );
          if (
            !customer ||
            normalize(customer.defaultEmailAddress?.emailAddress ?? "") !==
              normalize(Redacted.value(input.acceptedIdentity.email))
          ) {
            return yield* unavailable(
              "Verified registrant does not match the Shopify customer"
            );
          }
          const result = yield* admin.request(
            `query RegistrationLocation($id:ID!) { companyLocation(id:$id) { id company { id } } }`,
            { id: input.commerceAccount.businessUnitId }
          );
          const location = yield* decodeCompanyResource(
            Schema.Struct({
              company: Schema.Struct({ id: Schema.String }),
              id: Schema.String,
            }),
            result.companyLocation
          );
          if (location.id !== input.commerceAccount.businessUnitId) {
            return yield* unavailable("Registration location does not match");
          }
          const binding = yield* provide(
            resolveRoleBinding(location.company.id, bindings)
          );
          if (!binding) {
            return yield* unavailable(
              "Registration company roles have not been configured"
            );
          }
          if (
            customer.companyContactProfiles.some(
              (contact) => contact.company.id !== location.company.id
            )
          ) {
            return yield* unavailable(
              "Customer belongs to another Shopify company"
            );
          }
          yield* provide(
            claimIdentity({
              authUserId: input.acceptedIdentity.authUserId,
              customerId: customer.id,
            })
          );
          let current = customer;
          if (!current.companyContactProfiles.length) {
            const linked = yield* admin.request(
              `mutation RegistrationContactLink($companyId:ID!,$customerId:ID!) { companyAssignCustomerAsContact(companyId:$companyId,customerId:$customerId) { companyContact { id } userErrors { message } } }`,
              { companyId: location.company.id, customerId: customer.id }
            );
            yield* companyMutationResult(
              linked,
              "companyAssignCustomerAsContact"
            );
            const refreshed = yield* provide(readCustomer(customer.id));
            if (!refreshed) {
              return yield* unavailable(
                "Registration contact could not be confirmed"
              );
            }
            current = refreshed;
          }
          const [contact] = current.companyContactProfiles;
          if (
            current.companyContactProfiles.length !== 1 ||
            !contact ||
            contact.company.id !== location.company.id ||
            contact.roleAssignments.pageInfo.hasNextPage
          ) {
            return yield* unavailable(
              "Registration contact is ambiguous or incomplete"
            );
          }
          if (
            !contact.roleAssignments.nodes.some(
              (assignment) =>
                assignment.companyLocation.id === location.id &&
                binding.adminRoleIds.includes(assignment.role.id)
            )
          ) {
            const adminRoleId = binding.adminRoleIds[0];
            if (!adminRoleId)
              return yield* unavailable(
                "Configure a native Shopify administrator role before provisioning registration administrators"
              );
            const assigned = yield* admin.request(
              `mutation RegistrationAdministratorAssign($contactId:ID!,$locationId:ID!,$roleId:ID!) { companyContactAssignRole(companyContactId:$contactId,companyLocationId:$locationId,companyContactRoleId:$roleId) { companyContactRoleAssignment { id } userErrors { message } } }`,
              {
                contactId: contact.id,
                locationId: location.id,
                roleId: adminRoleId,
              }
            );
            yield* companyMutationResult(assigned, "companyContactAssignRole");
          }
          const verified = yield* provide(readCustomer(customer.id));
          if (
            !verified?.companyContactProfiles.some(
              (candidate) =>
                candidate.company.id === location.company.id &&
                !candidate.roleAssignments.pageInfo.hasNextPage &&
                candidate.roleAssignments.nodes.some(
                  (assignment) =>
                    assignment.companyLocation.id === location.id &&
                    binding.adminRoleIds.includes(assignment.role.id)
                )
            )
          ) {
            return yield* unavailable(
              "Initial administrator access could not be confirmed; retry onboarding"
            );
          }
          return input.commerceAccount;
        }).pipe(
          Effect.mapError((error) =>
            error._tag === "CommerceAccountUnavailable"
              ? error
              : unavailable("Shopify registrant identity could not be linked")
          )
        );
      return CommerceAccounts.of({
        addAssociate: members.addMember,
        createFromRegistration: create,
        getCustomerIdByAuthUserId: (authUserId) =>
          resolveCustomer(authUserId).pipe(
            Effect.flatMap((customer) =>
              customer
                ? Effect.succeed(CommerceCustomerId.make(customer.id))
                : Effect.fail(
                    new CommerceCustomerIdNotFound({
                      authUserId,
                      message: "Shopify customer is not linked",
                    })
                  )
            )
          ),
        getCustomerProfile: (customerId) =>
          provide(readCustomer(customerId)).pipe(
            Effect.flatMap((customer) =>
              customer
                ? Effect.succeed(
                    new CommerceCustomerProfile({
                      customerId,
                      email: customer.defaultEmailAddress
                        ? Redacted.make(
                            customer.defaultEmailAddress.emailAddress,
                            { label: "email" }
                          )
                        : undefined,
                      firstName: customer.firstName
                        ? Redacted.make(customer.firstName, {
                            label: "personName",
                          })
                        : undefined,
                      lastName: customer.lastName
                        ? Redacted.make(customer.lastName, {
                            label: "personName",
                          })
                        : undefined,
                    })
                  )
                : Effect.fail(
                    new CommerceCustomerProfileNotFound({
                      customerId,
                      message: "Shopify customer was not found",
                    })
                  )
            )
          ),
        hasCustomerWithEmail: (email) =>
          provide(findCustomer(Redacted.value(email))).pipe(
            Effect.map((customer) => customer !== undefined),
            Effect.mapError(() => unavailable("Shopify customer lookup failed"))
          ),
        linkRegistrantIdentity: link,
        listBusinessUnitMembershipsForCustomerInStore: (customerId) =>
          provide(readCustomer(customerId)).pipe(
            Effect.flatMap((customer) =>
              customer ? nativeMemberships(customer) : Effect.succeed([])
            )
          ),
      });
    })
  );
export const companyRegistrationEligibilityLayer = Layer.effect(
  CompanyRegistrationEligibility,
  Effect.gen(function* () {
    const admin = yield* ShopifyCompanyAdmin;
    const identities = yield* VersionedKeyValueStore;
    return {
      hasExistingAccount: ({ email, authUserId }) =>
        Effect.gen(function* () {
          const customer = yield* findCustomer(Redacted.value(email)).pipe(
            Effect.provideService(ShopifyCompanyAdmin, admin)
          );
          if ((customer?.companyContactProfiles.length ?? 0) > 0) {
            return true;
          }
          if (!authUserId) {
            return false;
          }
          const link = yield* identities.get(
            identityKey("auth", authUserId),
            IdentityLink
          );
          if (Option.isNone(link)) {
            return false;
          }
          const linked = yield* readCustomer(link.value.value.customerId).pipe(
            Effect.provideService(ShopifyCompanyAdmin, admin)
          );
          return (linked?.companyContactProfiles.length ?? 0) > 0;
        }).pipe(
          Effect.mapError(() =>
            unavailable(
              "Shopify registration eligibility could not be verified"
            )
          )
        ),
    };
  })
);
export const commerceAccountsLayer = Layer.suspend(() => {
  const bindings = companyRoleBindings();
  const admin = ShopifyCompanyAdmin.layer;
  const identities = companyStorageLayer("identities").pipe(
    Layer.provide(admin)
  );
  const members = companyMemberProvisioningLayerWith(bindings).pipe(
    Layer.provide(identities),
    Layer.provide(admin)
  );
  return Layer.mergeAll(
    companyPurchasingPoliciesLayer,
    companyRegistrationEligibilityLayer,
    commerceAccountsLayerWith(bindings, registrationRoles())
  ).pipe(
    Layer.provideMerge(members),
    Layer.provide(identities),
    Layer.provide(admin)
  );
});
