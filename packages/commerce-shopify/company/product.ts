import { ProductDiscoveryFailure } from "@repo/commerce-core/product/product-discovery";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { Layer } from "effect";
import { Effect, Redacted, Schema } from "effect";

import { ShopifyCustomerAccounts } from "../customer-account/accounts";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Provider-owned product Layer composition.
import { productDiscoveryLayerWith } from "../product";
import { ShopifyCompanyAdmin } from "./admin";
import { ShopifyPurchasingPolicyBindings } from "./purchasing-policy-bindings";

const PricingMarketPage = Schema.Struct({
  catalogs: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        priceList: Schema.NullOr(Schema.Struct({ currency: Schema.String })),
        publication: Schema.NullOr(Schema.Struct({ id: Schema.String })),
        status: Schema.String,
      })
    ),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  }),
  conditions: Schema.NullOr(
    Schema.Struct({
      companyLocationsCondition: Schema.NullOr(
        Schema.Struct({
          applicationLevel: Schema.NullOr(Schema.String),
          companyLocations: Schema.Struct({
            nodes: Schema.Array(Schema.Struct({ id: Schema.String })),
            pageInfo: Schema.Struct({
              endCursor: Schema.NullOr(Schema.String),
              hasNextPage: Schema.Boolean,
            }),
          }),
        })
      ),
      conditionTypes: Schema.Array(Schema.String),
    })
  ),
  id: Schema.String,
  status: Schema.String,
});
const pricingMarketQuery = `
  query SearchBuyerPricingMarket($id:ID!, $after:String) {
    market(id:$id) {
      id status
      catalogs(first:2) {
        nodes { id status publication { id } priceList { currency } }
        pageInfo { hasNextPage }
      }
      conditions {
        conditionTypes
        companyLocationsCondition {
          applicationLevel
          companyLocations(first:250, after:$after) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  }
`;

/** Only the current buyer's match is retained; no company membership map is materialized. */
const matchesPricingMarket = Effect.fn("ShopifyProduct.matchesPricingMarket")(
  function* (
    policy: ShopifyPurchasingPolicyBindings[number],
    companyLocationId: string
  ) {
    const admin = yield* ShopifyCompanyAdmin;
    let after: string | null = null;
    const cursors = new Set<string>();
    while (true) {
      const data: Record<string, Schema.Json> = yield* admin.request(
        pricingMarketQuery,
        {
          after,
          id: policy.pricingMarketId,
        }
      );
      const market = yield* Schema.decodeUnknownEffect(PricingMarketPage)(
        data.market
      );
      const condition = market.conditions?.companyLocationsCondition;
      const [catalog] = market.catalogs.nodes;
      if (
        market.id !== policy.pricingMarketId ||
        market.status !== "ACTIVE" ||
        market.conditions?.conditionTypes.length !== 1 ||
        market.conditions.conditionTypes[0] !== "COMPANY_LOCATION" ||
        !condition ||
        condition.applicationLevel !== "SPECIFIC" ||
        market.catalogs.pageInfo.hasNextPage ||
        market.catalogs.nodes.length !== 1 ||
        catalog?.id !== policy.pricingCatalogId ||
        catalog.status !== "ACTIVE" ||
        catalog.publication !== null ||
        catalog.priceList?.currency !== policy.currency
      ) {
        return yield* new ProductDiscoveryFailure({
          message:
            "Shopify search requires an active price-only pricing Market with explicit company locations and the configured Catalog and currency",
          operation: "searchAudience",
        });
      }
      if (
        condition.companyLocations.nodes.some(
          ({ id }) => id === companyLocationId
        )
      ) {
        return true;
      }
      const page = condition.companyLocations.pageInfo;
      if (!page.hasNextPage) {
        return false;
      }
      if (!page.endCursor || cursors.has(page.endCursor)) {
        return yield* Effect.die(
          "Shopify returned an invalid pricing Market membership cursor"
        );
      }
      cursors.add(page.endCursor);
      after = page.endCursor;
    }
  }
);

export const companyProductDiscoveryLayerWith = (
  adminLayer: Layer.Layer<ShopifyCompanyAdmin>,
  bindings: () => ShopifyPurchasingPolicyBindings
) =>
  productDiscoveryLayerWith(
    Effect.gen(function* () {
      const { principal, store } = yield* CommerceContext;
      const accounts = yield* ShopifyCustomerAccounts;
      const identity = yield* accounts.read.pipe(Effect.orDie);
      if (
        principal._tag !== "CustomerCommercePrincipal" ||
        !identity?.accessToken ||
        identity.customer.id !== principal.customerId ||
        identity.authUserId !== principal.authUserId
      ) {
        return yield* Effect.die(
          "A verified Shopify company buyer is required for this catalog"
        );
      }
      return {
        companyLocationId: principal.businessUnitId,
        customerAccessToken: Redacted.value(identity.accessToken),
        searchAudience: Effect.gen(function* () {
          const policies = bindings().filter(
            (policy) =>
              policy.storeKey === store.storeKey &&
              policy.locale === store.locale &&
              policy.currency === store.currency
          );
          if (policies.length === 0) {
            return yield* new ProductDiscoveryFailure({
              message:
                "No Shopify search pricing groups are configured for this Store/locale",
              operation: "searchAudience",
            });
          }
          // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach takes an iterable and callback, not an Array thisArg.
          const matches = yield* Effect.forEach(policies, (policy) =>
            matchesPricingMarket(policy, principal.businessUnitId).pipe(
              Effect.map((matched) =>
                matched ? policy.pricingGroupKey : undefined
              )
            )
          );
          const groups = [
            ...new Set(matches.filter((key) => key !== undefined)),
          ];
          if (groups.length !== 1) {
            return yield* new ProductDiscoveryFailure({
              message:
                "The selected Shopify company location must match exactly one configured search pricing group",
              operation: "searchAudience",
            });
          }
          return { priceAudienceIds: groups.map((key) => `group:${key}`) };
        }).pipe(
          Effect.provide(adminLayer),
          Effect.mapError((cause) =>
            cause._tag === "ProductDiscoveryFailure"
              ? cause
              : new ProductDiscoveryFailure({
                  cause,
                  message:
                    "Could not resolve the selected company's search pricing group; check its pricing Market membership and Store configuration",
                  operation: "searchAudience",
                })
          )
        ),
      };
    })
  );

export const companyProductDiscoveryLayer = companyProductDiscoveryLayerWith(
  ShopifyCompanyAdmin.layer,
  () =>
    Schema.decodeSync(Schema.fromJsonString(ShopifyPurchasingPolicyBindings))(
      process.env.SHOPIFY_COMPANY_PURCHASING_POLICIES ?? "[]"
    )
);
