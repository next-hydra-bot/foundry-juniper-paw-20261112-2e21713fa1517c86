import { describe, expect, it } from "@effect/vitest";
import { CommerceCustomerId } from "@repo/commerce-core/domain/commerce-account";
import { AuthUserId } from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceBuyerAccounts } from "@repo/commerce-core/services/commerce-buyer-accounts";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Schema } from "effect";

import { customerAccountFixture } from "../testing/customer-account";
import { companyBuyerAccountsLayerWith } from "./accounts";

const environment = {
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: "client",
  SHOPIFY_CUSTOMER_SESSION_SECRET:
    "test-session-secret-at-least-thirty-two-characters",
  SHOPIFY_SHOP_ID: "123",
  SHOPIFY_STOREFRONT_ORIGIN: "https://store.example",
};
const location = (id: number, currency?: string) => ({
  externalId: null,
  id: `gid://shopify/CompanyLocation/${id}`,
  marketCurrencyCode: currency,
  name: `Location ${id}`,
});
const fixture = (withRoleBindings = false) => {
  let locations = [location(1), location(2), location(3, "GBP")];
  let wrongCustomer = false;
  let truncated = false;
  const requests: Schema.Json[] = [];
  const layer = companyBuyerAccountsLayerWith({
    environment,
    roleBindings: withRoleBindings
      ? [
          {
            companyId: "gid://shopify/Company/1",
            buyerRoleId: "gid://shopify/CompanyContactRole/1",
            adminRoleIds: ["gid://shopify/CompanyContactRole/2"],
          },
        ]
      : [],
    fetchApi: async (_url, init) => {
      const request = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            query: Schema.String,
            variables: Schema.Record(Schema.String, Schema.Json),
          })
        )
      )(await new Response(init?.body).text());
      requests.push(request);
      if (request.query.includes("CompanyBuyerRole")) {
        return Response.json({
          data: {
            companyLocation: {
              id: request.variables.id,
              roleAssignments: {
                nodes: [
                  {
                    contact: {
                      id:
                        request.variables.id ===
                        "gid://shopify/CompanyLocation/3"
                          ? "another-contact"
                          : "gid://shopify/CompanyContact/1",
                    },
                    role: {
                      id:
                        request.variables.id ===
                        "gid://shopify/CompanyLocation/2"
                          ? "gid://shopify/CompanyContactRole/1"
                          : "gid://shopify/CompanyContactRole/2",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      }
      return Response.json({
        data: {
          customer: {
            companyContacts: {
              nodes: [
                {
                  id: "gid://shopify/CompanyContact/1",
                  company: {
                    id: "gid://shopify/Company/1",
                    name: "Earthworks",
                  },
                  locations: {
                    nodes: locations,
                    pageInfo: { hasNextPage: truncated },
                  },
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
            id: wrongCustomer ? "other-customer" : "gid://shopify/Customer/1",
          },
        },
      });
    },
  }).pipe(Layer.provide(customerAccountFixture()));
  return {
    layer,
    requests,
    revoke: () => {
      locations = [];
    },
    truncate: () => {
      truncated = true;
    },
    wrongCustomer: () => {
      wrongCustomer = true;
    },
  };
};
const store = resolveStore({ locale: CommerceLocale.make("en-US") });
const customerId = CommerceCustomerId.make("gid://shopify/Customer/1");

describe("Shopify company buyer access", () => {
  it.effect(
    "returns all live authorized locations regardless of currency metadata and never grants company administration",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const first = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.listBusinessUnitMembershipsForCustomerInStore(
              customerId,
              store
            )
          ),
          Effect.provide(source.layer)
        );
        expect(
          first.map(({ businessUnitId, roles }) => ({ businessUnitId, roles }))
        ).toEqual([
          {
            businessUnitId: "gid://shopify/CompanyLocation/1",
            roles: ["buyer"],
          },
          {
            businessUnitId: "gid://shopify/CompanyLocation/2",
            roles: ["buyer"],
          },
          {
            businessUnitId: "gid://shopify/CompanyLocation/3",
            roles: ["buyer"],
          },
        ]);
        source.revoke();
        const next = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.listBusinessUnitMembershipsForCustomerInStore(
              customerId,
              store
            )
          ),
          Effect.provide(source.layer)
        );
        expect(next).toEqual([]);
        expect(source.requests).toHaveLength(2);
      })
  );
  it.effect(
    "grants invitation administration only for explicitly bound roles on the current contact and location",
    () =>
      Effect.gen(function* () {
        const source = fixture(true);
        const memberships = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.listBusinessUnitMembershipsForCustomerInStore(
              customerId,
              store
            )
          ),
          Effect.provide(source.layer)
        );
        expect(memberships.map(({ roles }) => roles)).toEqual([
          ["admin", "buyer"],
          ["buyer"],
          ["buyer"],
        ]);
      })
  );
  it.effect(
    "rejects a mismatched site identity, another API customer and incomplete membership reads",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const identity = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.getCustomerIdByAuthUserId(
              AuthUserId.make("other-site-user")
            )
          ),
          Effect.result,
          Effect.provide(source.layer)
        );
        source.wrongCustomer();
        const other = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.listBusinessUnitMembershipsForCustomerInStore(
              customerId,
              store
            )
          ),
          Effect.result,
          Effect.provide(source.layer)
        );
        const incomplete = fixture();
        incomplete.truncate();
        const truncated = yield* CommerceBuyerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.listBusinessUnitMembershipsForCustomerInStore(
              customerId,
              store
            )
          ),
          Effect.result,
          Effect.provide(incomplete.layer)
        );
        expect([identity._tag, other._tag, truncated._tag]).toEqual([
          "Failure",
          "Failure",
          "Failure",
        ]);
      })
  );
});
