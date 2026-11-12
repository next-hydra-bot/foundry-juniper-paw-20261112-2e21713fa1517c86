import "server-only";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceBusinessUnitLabel,
  CommerceBusinessUnitMembership,
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import type { CompanyRoles } from "@repo/commerce-core/domain/commerce-account";
import {
  CommerceAccountUnavailable,
  CommerceCustomerIdNotFound,
  CommerceCustomerProfileNotFound,
} from "@repo/commerce-core/services/commerce-accounts";
import { CommerceBuyerAccounts } from "@repo/commerce-core/services/commerce-buyer-accounts";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { createShopifyRequestContext } from "@shopify/hydrogen";
import {
  createCustomerAccountClient,
  gql,
} from "@shopify/hydrogen/customer-account";
import { Effect, Layer, Redacted, Schema } from "effect";

import { ShopifyCustomerAccounts } from "../customer-account/accounts";
import { customerAccountKeys } from "../customer-account/keys";
import { storefrontContext } from "../store";
import { ShopifyCompanyAdmin } from "./admin";
import { companyRoleBindings } from "./keys";
import type { CompanyRoleBindings } from "./keys";
import type { RoleBinding } from "./resources";
import { resolveRoleBinding } from "./resources";
import { companyStorageLayer } from "./storage";

const query = gql(`query CompanyBuyerAccess($after:String) {
  customer {
    id
    companyContacts(first:2,after:$after) {
      nodes {
        id
        company { id name }
        locations(first:250) {
          nodes { id name }
          pageInfo { hasNextPage }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`);
const companyRoleQuery = gql(`query CompanyBuyerRole($id:ID!,$query:String!) {
  companyLocation(id:$id) { id roleAssignments(first:2,query:$query) { nodes { contact { id } role { id } } pageInfo { hasNextPage } } }
}`);
const CompanyRoleResponse = Schema.Struct({
  companyLocation: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      roleAssignments: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            contact: Schema.Struct({ id: Schema.String }),
            role: Schema.Struct({ id: Schema.String }),
          })
        ),
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
      }),
    })
  ),
});
const Response = Schema.Struct({
  customer: Schema.Struct({
    companyContacts: Schema.Struct({
      nodes: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          company: Schema.NullOr(
            Schema.Struct({ id: Schema.String, name: Schema.String })
          ),
          locations: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                id: Schema.String.check(
                  Schema.isPattern(/^gid:\/\/shopify\/CompanyLocation\/\d+$/u)
                ),
                name: Schema.String,
              })
            ),
            pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
          }),
        })
      ),
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String),
      }),
    }),
    id: Schema.String,
  }),
});

/** A live Customer Account API query establishes location membership; cookies are selectors only. */
export const companyBuyerAccountsLayerWith = ({
  environment,
  fetchApi = globalThis.fetch,
  roleBindings = [],
  resolveRoles,
}: {
  readonly environment: ReturnType<typeof customerAccountKeys>;
  readonly fetchApi?: typeof globalThis.fetch;
  readonly roleBindings?: CompanyRoleBindings;
  readonly resolveRoles?: (
    companyId: string
  ) => Effect.Effect<
    typeof RoleBinding.Type | undefined,
    CommerceAccountUnavailable
  >;
}) =>
  Layer.effect(
    CommerceBuyerAccounts,
    Effect.gen(function* () {
      const accounts = yield* ShopifyCustomerAccounts;
      const identity = accounts.read.pipe(
        Effect.mapError(
          () =>
            new CommerceAccountUnavailable({
              message: "Shopify company access could not be verified",
            })
        )
      );
      return CommerceBuyerAccounts.of({
        getCustomerIdByAuthUserId: (authUserId) =>
          Effect.gen(function* () {
            const current = yield* identity;
            if (!current?.accessToken || current.authUserId !== authUserId) {
              return yield* new CommerceCustomerIdNotFound({
                authUserId,
                message:
                  "Connect the Shopify customer session before company purchasing",
              });
            }
            return CommerceCustomerId.make(current.customer.id);
          }),
        getCustomerProfile: (customerId) =>
          Effect.gen(function* () {
            const current = yield* identity;
            if (!current || current.customer.id !== customerId) {
              return yield* new CommerceCustomerProfileNotFound({
                customerId,
                message: "The Shopify customer session does not match",
              });
            }
            const customer = yield* accounts.profile.pipe(
              Effect.mapError(
                () =>
                  new CommerceAccountUnavailable({
                    message: "Shopify customer details could not be read.",
                  })
              )
            );
            return new CommerceCustomerProfile({
              customerId,
              email: Redacted.make(customer.email, { label: "email" }),
              firstName:
                customer.firstName === null
                  ? undefined
                  : Redacted.make(customer.firstName, {
                      label: "personName",
                    }),
              lastName:
                customer.lastName === null
                  ? undefined
                  : Redacted.make(customer.lastName, {
                      label: "personName",
                    }),
            });
          }),
        listBusinessUnitMembershipsForCustomerInStore: (customerId, store) =>
          Effect.gen(function* () {
            const current = yield* identity;
            if (!current?.accessToken || current.customer.id !== customerId) {
              return yield* new CommerceAccountUnavailable({
                message: "The Shopify customer session does not match",
              });
            }
            const accessToken = Redacted.value(current.accessToken);
            const client = createCustomerAccountClient({
              fetch: async (input, init) =>
                await fetchApi(input, { ...init, cache: "no-store" }),
              requestContext: createShopifyRequestContext({
                i18n: storefrontContext(store),
                request: {
                  headers: new Headers(),
                  url: environment.SHOPIFY_STOREFRONT_ORIGIN,
                },
              }),
              shopId: environment.SHOPIFY_SHOP_ID,
            });
            const memberships = new Map<
              string,
              CommerceBusinessUnitMembership
            >();
            let after: string | null = null;
            const cursors = new Set<string>();
            while (true) {
              const cursor: string | null = after;
              const data: typeof Response.Type = yield* Effect.tryPromise({
                catch: () =>
                  new CommerceAccountUnavailable({
                    message: "Shopify company access could not be verified",
                  }),
                try: async (signal) => {
                  const result = await client.graphql(query, {
                    accessToken,
                    signal,
                    variables: { after: cursor },
                  });
                  if ((result.errors?.length ?? 0) > 0) {
                    throw new Error("Company access rejected");
                  }
                  return result.data;
                },
              }).pipe(
                Effect.flatMap((raw) =>
                  Schema.decodeUnknownEffect(Response)(raw)
                ),
                Effect.mapError(
                  () =>
                    new CommerceAccountUnavailable({
                      message: "Shopify company access could not be verified",
                    })
                )
              );
              if (data.customer.id !== customerId) {
                return yield* new CommerceAccountUnavailable({
                  message: "Shopify returned a different customer",
                });
              }
              for (const contact of data.customer.companyContacts.nodes) {
                if (
                  !contact.company ||
                  contact.locations.pageInfo.hasNextPage
                ) {
                  return yield* new CommerceAccountUnavailable({
                    message:
                      "Company location access is missing or exceeds the supported 250 locations per company",
                  });
                }
                for (const location of contact.locations.nodes) {
                  let roles: CompanyRoles = ["buyer"];
                  const binding = yield* resolveRoles
                    ? resolveRoles(contact.company.id)
                    : Effect.succeed(
                        roleBindings.find(
                          ({ companyId }) => companyId === contact.company?.id
                        )
                      );
                  if (binding) {
                    const nativeRoles = yield* Effect.tryPromise({
                      try: async (signal) => {
                        const result = await client.graphql(companyRoleQuery, {
                          accessToken,
                          signal,
                          variables: {
                            id: location.id,
                            query: `company_contact_id:${contact.id.split("/").at(-1)}`,
                          },
                        });
                        if ((result.errors?.length ?? 0) > 0) {
                          throw new Error("Company role lookup rejected");
                        }
                        return result.data;
                      },
                      catch: () =>
                        new CommerceAccountUnavailable({
                          message:
                            "Shopify company permissions could not be verified",
                        }),
                    }).pipe(
                      Effect.flatMap(
                        Schema.decodeUnknownEffect(CompanyRoleResponse)
                      ),
                      Effect.mapError(
                        () =>
                          new CommerceAccountUnavailable({
                            message:
                              "Shopify company permissions could not be verified",
                          })
                      )
                    );
                    if (
                      nativeRoles.companyLocation?.id !== location.id ||
                      nativeRoles.companyLocation.roleAssignments.pageInfo
                        .hasNextPage
                    ) {
                      return yield* new CommerceAccountUnavailable({
                        message:
                          "Shopify company role assignments are incomplete",
                      });
                    }
                    if (
                      nativeRoles.companyLocation.roleAssignments.nodes.some(
                        (assignment) =>
                          assignment.contact.id === contact.id &&
                          binding.adminRoleIds.includes(assignment.role.id)
                      )
                    ) {
                      roles = ["admin", "buyer"];
                    }
                  }
                  memberships.set(
                    location.id,
                    new CommerceBusinessUnitMembership({
                      businessUnitId: CommerceBusinessUnitId.make(location.id),
                      businessUnitKey: CommerceBusinessUnitKey.make(
                        location.id
                      ),
                      businessUnitLabel: CommerceBusinessUnitLabel.make(
                        `${contact.company.name} — ${location.name}`
                      ),
                      roles,
                    })
                  );
                }
              }
              const page = data.customer.companyContacts.pageInfo;
              if (!page.hasNextPage) {
                break;
              }
              const nextCursor = page.endCursor;
              if (!nextCursor || cursors.has(nextCursor)) {
                return yield* new CommerceAccountUnavailable({
                  message: "Shopify returned invalid company pagination",
                });
              }
              after = nextCursor;
              cursors.add(nextCursor);
            }
            return [...memberships.values()];
          }),
      });
    })
  );
export const companyBuyerAccountsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const identities = yield* VersionedKeyValueStore;
    const configured = companyRoleBindings();
    return companyBuyerAccountsLayerWith({
      environment: customerAccountKeys(),
      resolveRoles: (companyId) =>
        resolveRoleBinding(companyId, configured).pipe(
          Effect.provideService(VersionedKeyValueStore, identities)
        ),
    });
  })
).pipe(
  Layer.provide(
    companyStorageLayer("identities").pipe(
      Layer.provide(ShopifyCompanyAdmin.layer)
    )
  )
);
