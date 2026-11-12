import "server-only";
import type { CompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { sameCompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CompanyPurchasingPolicies } from "@repo/commerce-core/services/company-purchasing-policies";
import { resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Schema } from "effect";

import {
  ShopifyCompanyAdmin,
  decodeCompanyResource,
  companyMutationResult,
} from "./admin";
import { ShopifyPurchasingPolicyBindings } from "./purchasing-policy-bindings";

export { ShopifyPurchasingPolicyBindings } from "./purchasing-policy-bindings";

const Resource = Schema.Struct({ id: Schema.String });
const Page = Schema.Struct({
  endCursor: Schema.optional(Schema.NullOr(Schema.String)),
  hasNextPage: Schema.Boolean,
});
const Market = Schema.Struct({
  catalogs: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        priceList: Schema.NullOr(Schema.Struct({ currency: Schema.String })),
        publication: Schema.NullOr(Resource),
        status: Schema.String,
      })
    ),
    pageInfo: Page,
  }),
  conditions: Schema.NullOr(
    Schema.Struct({
      companyLocationsCondition: Schema.NullOr(
        Schema.Struct({
          applicationLevel: Schema.NullOr(Schema.String),
          companyLocations: Schema.Struct({
            nodes: Schema.Array(Resource),
            pageInfo: Page,
          }),
        })
      ),
      conditionTypes: Schema.Array(Schema.String),
    })
  ),
  currencySettings: Schema.NullOr(
    Schema.Struct({
      baseCurrency: Schema.Struct({ currencyCode: Schema.String }),
      localCurrencies: Schema.Boolean,
    })
  ),
  id: Schema.String,
  status: Schema.String,
});
const fields =
  "id status currencySettings { baseCurrency { currencyCode } localCurrencies } conditions { conditionTypes companyLocationsCondition { applicationLevel companyLocations(first:250) { nodes { id } pageInfo { hasNextPage endCursor } } } } catalogs(first:2) { nodes { id status publication { id } priceList { currency } } pageInfo { hasNextPage } }";
const fail = (message: string) => new CommerceAccountUnavailable({ message });
const publicPolicy = ({
  key,
  label,
  storeKey,
  locale,
  currency,
  pricingGroupKey,
}: CompanyPurchasingPolicy): CompanyPurchasingPolicy => ({
  currency,
  key,
  label,
  locale,
  pricingGroupKey,
  storeKey,
});

export const companyPurchasingPoliciesLayerWith = (
  bindings: ShopifyPurchasingPolicyBindings
) =>
  Layer.effect(
    CompanyPurchasingPolicies,
    Effect.gen(function* () {
      const admin = yield* ShopifyCompanyAdmin;
      if (
        new Set(bindings.map(({ key }) => key)).size !== bindings.length ||
        bindings.some((policy) => {
          const store = resolveStore({
            locale: policy.locale,
            selectedStoreKey: policy.storeKey,
          });
          return (
            store.storeKey !== policy.storeKey ||
            store.currency !== policy.currency
          );
        })
      ) {
        return yield* fail(
          "Company purchasing policies require unique keys and explicit matching Store currencies."
        );
      }
      const allMarkets = Effect.gen(function* () {
        const result: (typeof Market.Type)[] = [];
        let after: string | null = null;
        const cursors = new Set<string>();
        while (true) {
          const data: Record<string, Schema.Json> = yield* admin.request(
            `query ApprovalPurchasingMarkets($after:String) { markets(first:50,after:$after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } }`,
            { after }
          );
          const page = yield* decodeCompanyResource(
            Schema.Struct({
              nodes: Schema.Array(Market),
              pageInfo: Schema.Struct({
                endCursor: Schema.NullOr(Schema.String),
                hasNextPage: Schema.Boolean,
              }),
            }),
            data.markets
          );
          for (const market of page.nodes) {
            const condition = market.conditions?.companyLocationsCondition;
            if (!condition || condition.applicationLevel === "ALL") {
              result.push(market);
              continue;
            }
            const members = [...condition.companyLocations.nodes];
            let membershipPage = condition.companyLocations.pageInfo;
            const memberCursors = new Set<string>();
            while (membershipPage.hasNextPage) {
              const cursor = membershipPage.endCursor;
              if (!cursor || memberCursors.has(cursor)) {
                return yield* fail(
                  "Shopify returned an invalid company membership cursor."
                );
              }
              memberCursors.add(cursor);
              const data = yield* admin.request(
                `query ApprovalPurchasingMarketMembers($id:ID!,$after:String!) { market(id:$id) { id conditions { companyLocationsCondition { companyLocations(first:250,after:$after) { nodes { id } pageInfo { hasNextPage endCursor } } } } } }`,
                { after: cursor, id: market.id }
              );
              const next = yield* decodeCompanyResource(
                Schema.Struct({
                  conditions: Schema.Struct({
                    companyLocationsCondition: Schema.Struct({
                      companyLocations: Schema.Struct({
                        nodes: Schema.Array(Resource),
                        pageInfo: Page,
                      }),
                    }),
                  }),
                  id: Schema.String,
                }),
                data.market
              );
              if (next.id !== market.id) {
                return yield* fail(
                  "Shopify returned another Market's membership."
                );
              }
              const connection =
                next.conditions.companyLocationsCondition.companyLocations;
              members.push(...connection.nodes);
              membershipPage = connection.pageInfo;
            }
            result.push({
              ...market,
              conditions: {
                ...market.conditions,
                companyLocationsCondition: {
                  ...condition,
                  companyLocations: {
                    nodes: members,
                    pageInfo: membershipPage,
                  },
                },
              },
            });
          }
          if (!page.pageInfo.hasNextPage) {
            return result;
          }
          if (
            !page.pageInfo.endCursor ||
            cursors.has(page.pageInfo.endCursor)
          ) {
            return yield* fail(
              "Shopify returned an incomplete purchasing policy listing."
            );
          }
          after = page.pageInfo.endCursor;
          cursors.add(after);
        }
      });
      return CompanyPurchasingPolicies.of({
        assign: ({ account, policy: approved }) =>
          Effect.gen(function* () {
            const { storeKey, key: policyKey } = approved;
            const policy = bindings.find(
              (candidate) =>
                candidate.storeKey === storeKey && candidate.key === policyKey
            );
            if (!policy || !sameCompanyPurchasingPolicy(policy, approved)) {
              return yield* fail(
                "The selected company purchasing policy is missing or its approved buying terms have changed."
              );
            }
            const raw = yield* admin.request(
              "query ApprovalPurchasingLocation($id:ID!) { companyLocation(id:$id) { id } }",
              { id: account.businessUnitId }
            );
            const location = yield* decodeCompanyResource(
              Resource,
              raw.companyLocation
            );
            if (location.id !== account.businessUnitId) {
              return yield* fail(
                "The company purchasing target does not match."
              );
            }
            const markets = yield* allMarkets;
            const desired = [
              {
                catalogId: policy.pricingCatalogId,
                id: policy.pricingMarketId,
              },
            ];
            for (const market of markets) {
              const condition = market.conditions?.companyLocationsCondition;
              if (
                market.status === "ACTIVE" &&
                condition &&
                condition.applicationLevel !== "ALL"
              ) {
                if (condition.companyLocations.pageInfo.hasNextPage) {
                  return yield* fail(
                    "Company purchasing memberships cannot be checked completely."
                  );
                }
                if (
                  condition.companyLocations.nodes.some(
                    ({ id }) => id === location.id
                  ) &&
                  !desired.some(({ id }) => id === market.id)
                ) {
                  return yield* fail(
                    "This location already has another B2B Market assignment. Reconcile it before assigning the approved policy."
                  );
                }
              }
            }
            // Validate the pricing target before writing; preserve other companies.
            const targets = [];
            for (const target of desired) {
              const market = markets.find(({ id }) => id === target.id);
              const condition = market?.conditions?.companyLocationsCondition;
              const catalog = market?.catalogs.nodes[0];
              if (
                market?.status !== "ACTIVE" ||
                market.conditions?.conditionTypes.length !== 1 ||
                !condition ||
                condition.applicationLevel === "ALL" ||
                condition.companyLocations.pageInfo.hasNextPage ||
                market.catalogs.pageInfo.hasNextPage ||
                market.catalogs.nodes.length !== 1 ||
                catalog?.id !== target.catalogId ||
                catalog.status !== "ACTIVE" ||
                market.currencySettings?.baseCurrency.currencyCode !==
                  policy.currency ||
                market.currencySettings.localCurrencies ||
                catalog.priceList?.currency !== policy.currency ||
                catalog.publication !== null
              ) {
                return yield* fail(
                  "Provision the exact active pricing Market/catalog before assigning this policy."
                );
              }
              targets.push({ condition, market });
            }
            for (const { market, condition } of targets) {
              if (
                condition.companyLocations.nodes.some(
                  ({ id }) => id === location.id
                )
              ) {
                continue;
              }
              const data = yield* admin.request(
                "mutation ApprovalPurchasingAssign($id:ID!,$input:MarketUpdateInput!) { marketUpdate(id:$id,input:$input) { market { id } userErrors { message } } }",
                {
                  id: market.id,
                  input: {
                    conditions: {
                      conditionsToAdd: {
                        companyLocationsCondition: {
                          companyLocationIds: [location.id],
                        },
                      },
                    },
                  },
                }
              );
              yield* companyMutationResult(data, "marketUpdate");
            }
            const verified = yield* allMarkets;
            if (
              desired.some(
                (target) =>
                  !verified
                    .find(({ id }) => id === target.id)
                    ?.conditions?.companyLocationsCondition?.companyLocations.nodes.some(
                      ({ id }) => id === location.id
                    )
              )
            ) {
              return yield* fail(
                "Company purchasing assignment could not be confirmed; retry onboarding to reconcile it."
              );
            }
          }),
        list: (storeKey) =>
          Effect.succeed(
            bindings
              .filter((policy) => policy.storeKey === storeKey)
              .map(publicPolicy)
          ),
      });
    })
  );
export const companyPurchasingPoliciesLayer = Layer.suspend(() =>
  companyPurchasingPoliciesLayerWith(
    Schema.decodeSync(Schema.fromJsonString(ShopifyPurchasingPolicyBindings))(
      process.env.SHOPIFY_COMPANY_PURCHASING_POLICIES ?? "[]"
    )
  ).pipe(Layer.provide(ShopifyCompanyAdmin.layer))
);
