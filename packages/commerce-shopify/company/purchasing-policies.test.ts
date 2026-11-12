import { describe, expect, it } from "@effect/vitest";
import {
  CommerceAccount,
  CommerceBusinessUnitId,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { CompanyPurchasingPolicyKey } from "@repo/commerce-core/domain/company-purchasing-policy";
import { CompanyPurchasingPolicies } from "@repo/commerce-core/services/company-purchasing-policies";
import { CommerceLocale, StoreKey } from "@repo/commerce-core/store";
import { Effect, Layer, Schema } from "effect";

import { ShopifyCompanyAdmin } from "./admin";
import { companyPurchasingPoliciesLayerWith } from "./purchasing-policies";

const policy = {
  currency: "USD",
  key: CompanyPurchasingPolicyKey.make("gold-earthworks"),
  label: "Gold dealers / Earthworks",
  locale: CommerceLocale.make("en-US"),
  pricingCatalogId: "gid://shopify/MarketCatalog/1",
  pricingGroupKey: "gold-dealers",
  pricingMarketId: "gid://shopify/Market/1",
  storeKey: StoreKey.make("default-store"),
};
const account = new CommerceAccount({
  businessUnitId: CommerceBusinessUnitId.make(
    "gid://shopify/CompanyLocation/1"
  ),
  customerId: CommerceCustomerId.make("gid://shopify/Customer/1"),
  registrationId: "registration-1",
});
const assignment = { account, policy };
const fixture = () => {
  const memberships = new Map([
    [policy.pricingMarketId, new Set(["gid://shopify/CompanyLocation/99"])],
  ]);
  const writes: string[] = [];
  let lose = false;
  let invalid = false;
  const fetchApi: typeof fetch = async (_url, init) => {
    const catalogId = invalid ? "other-catalog" : policy.pricingCatalogId;
    const bodyText = await new Response(init?.body).text();
    const { query, variables: rawVariables } = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({ query: Schema.String, variables: Schema.Json })
      )
    )(bodyText);
    if (query.includes("ApprovalPurchasingLocation")) {
      return await Promise.resolve(
        Response.json({
          data: { companyLocation: { id: account.businessUnitId } },
        })
      );
    }
    if (query.includes("ApprovalPurchasingMarketMembers")) {
      const variables = Schema.decodeUnknownSync(
        Schema.Struct({ after: Schema.String, id: Schema.String })
      )(rawVariables);
      const offset = Number(variables.after);
      const members = [...(memberships.get(variables.id) ?? [])];
      const nodes = members.slice(offset, offset + 250).map((id) => ({ id }));
      return Response.json({
        data: {
          market: {
            conditions: {
              companyLocationsCondition: {
                companyLocations: {
                  nodes,
                  pageInfo: {
                    endCursor: String(offset + 250),
                    hasNextPage: offset + 250 < members.length,
                  },
                },
              },
            },
            id: variables.id,
          },
        },
      });
    }
    if (query.includes("ApprovalPurchasingAssign")) {
      const variables = Schema.decodeUnknownSync(
        Schema.Struct({
          id: Schema.String,
          input: Schema.Struct({
            conditions: Schema.Struct({
              conditionsToAdd: Schema.Struct({
                companyLocationsCondition: Schema.Struct({
                  companyLocationIds: Schema.NonEmptyArray(Schema.String),
                }),
              }),
            }),
          }),
        })
      )(rawVariables);
      memberships
        .get(variables.id)
        ?.add(
          variables.input.conditions.conditionsToAdd.companyLocationsCondition
            .companyLocationIds[0]
        );
      writes.push(variables.id);
      if (lose) {
        lose = false;
        throw new Error("Lost after commit");
      }
      return await Promise.resolve(
        Response.json({
          data: {
            marketUpdate: { market: { id: variables.id }, userErrors: [] },
          },
        })
      );
    }
    return await Promise.resolve(
      Response.json({
        data: {
          markets: {
            nodes: [...memberships].map(([id, members]) => ({
              catalogs: {
                nodes: [
                  {
                    id: catalogId,
                    priceList:
                      id === policy.pricingMarketId
                        ? { currency: "USD" }
                        : null,
                    publication:
                      id === policy.pricingMarketId
                        ? null
                        : { id: "publication-1" },
                    status: "ACTIVE",
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
              conditions: {
                companyLocationsCondition: {
                  applicationLevel: "SPECIFIC",
                  companyLocations: {
                    nodes: [...members]
                      .slice(0, 250)
                      .map((member) => ({ id: member })),
                    pageInfo: {
                      endCursor: "250",
                      hasNextPage: members.size > 250,
                    },
                  },
                },
                conditionTypes: ["COMPANY_LOCATION"],
              },
              currencySettings: {
                baseCurrency: { currencyCode: "USD" },
                localCurrencies: false,
              },
              id,
              status: "ACTIVE",
            })),
            pageInfo: { endCursor: null, hasNextPage: false },
          },
        },
      })
    );
  };
  return {
    invalidate: () => {
      invalid = true;
    },
    layer: companyPurchasingPoliciesLayerWith([policy]).pipe(
      Layer.provide(
        ShopifyCompanyAdmin.layerWith(
          {
            SHOPIFY_ADMIN_ACCESS_TOKEN: "test",
            SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
          },
          fetchApi
        )
      )
    ),
    lose: () => {
      lose = true;
    },
    memberships,
    writes,
  };
};

describe("Shopify approval purchasing assignment", () => {
  it.effect(
    "does not assign over an existing unrelated B2B Market membership",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        source.memberships.set(
          "another-market",
          new Set([account.businessUnitId])
        );
        yield* CompanyPurchasingPolicies.pipe(
          Effect.flatMap((policies) => policies.assign(assignment)),
          Effect.flip,
          Effect.provide(source.layer)
        );
        expect(source.writes).toEqual([]);
      })
  );
  it.effect(
    "adds only the approved location to the pricing Market and recovers a partial commit",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const policies = yield* CompanyPurchasingPolicies;
          const [choice] = yield* policies.list(policy.storeKey);
          expect(choice).not.toHaveProperty("pricingMarketId");
          expect(yield* policies.list(StoreKey.make("another-store"))).toEqual(
            []
          );
          source.lose();
          yield* policies.assign(assignment).pipe(Effect.flip);
          yield* policies.assign(assignment);
          yield* policies.assign(assignment);
          expect(source.writes).toEqual([policy.pricingMarketId]);
          expect([
            ...(source.memberships.get(policy.pricingMarketId) ?? []),
          ]).toEqual([
            "gid://shopify/CompanyLocation/99",
            account.businessUnitId,
          ]);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect(
    "validates the native pricing catalog binding before writing and rejects unconfigured policy keys",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        source.invalidate();
        yield* Effect.gen(function* () {
          const policies = yield* CompanyPurchasingPolicies;
          expect(
            (yield* policies.assign(assignment).pipe(Effect.flip))._tag
          ).toBe("CommerceAccountUnavailable");
          yield* policies
            .assign({
              account,
              policy: {
                ...policy,
                key: CompanyPurchasingPolicyKey.make("unconfigured"),
              },
            })
            .pipe(Effect.flip);
          yield* policies
            .assign({
              account,
              policy: { ...policy, pricingGroupKey: "changed-terms" },
            })
            .pipe(Effect.flip);
          expect(source.writes).toEqual([]);
        }).pipe(Effect.provide(source.layer));
      })
  );
});

it.effect(
  "paginates target and unrelated Markets beyond 250 company locations",
  () =>
    Effect.gen(function* () {
      const source = fixture();
      const existing = Array.from(
        { length: 300 },
        (_, index) => `gid://shopify/CompanyLocation/${index + 1000}`
      );
      source.memberships.set(policy.pricingMarketId, new Set(existing));
      source.memberships.set("unrelated-market", new Set(existing));
      yield* CompanyPurchasingPolicies.pipe(
        Effect.flatMap((policies) => policies.assign(assignment)),
        Effect.provide(source.layer)
      );
      expect(source.writes).toEqual([policy.pricingMarketId]);
      expect(source.memberships.get(policy.pricingMarketId)?.size).toBe(301);
      expect(source.memberships.get("unrelated-market")?.size).toBe(300);
    })
);
