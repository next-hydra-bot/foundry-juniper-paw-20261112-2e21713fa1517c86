import { CommerceSearchIndexingFailure } from "@repo/commerce-core/search-indexing";
import { storeConfiguration } from "@repo/commerce-core/store";
import { Config, ConfigProvider, Effect, Schema } from "effect";

import { prepareAdminSettings } from "../admin/provisioning";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Provider CLI composition reuses its existing Admin transport and token cache.
import { makeCatalogAdmin } from "../catalog/admin";
import { ShopifyPurchasingPolicyBindings } from "../company/purchasing-policy-bindings";
import { shopifyConfiguration } from "../store";
import { loadSearchCategories } from "./search-categories";

/** Provisioning reads only explicitly bound pricing Markets; storefront requests never load these lists. */
const loadPriceGroups = Effect.fn("ShopifySearch.priceGroups")(function* (
  admin: ReturnType<typeof makeCatalogAdmin>,
  bindings: ShopifyPurchasingPolicyBindings
) {
  if (bindings.length === 0) {
    return yield* new CommerceSearchIndexingFailure({
      message:
        "B2B search requires SHOPIFY_COMPANY_PURCHASING_POLICIES with explicit pricing group and Market Catalog bindings",
      operation: "resolveIndexingContext",
    });
  }
  const groups: {
    key: string;
    storeKey: string;
    locale: string;
    currency: string;
    companyLocationIds: readonly string[];
    marketId: string;
    catalogId: string;
  }[] = [];
  const cache = new Map<string, readonly string[]>();
  for (const binding of bindings) {
    const cacheKey = `${binding.pricingMarketId}/${binding.pricingCatalogId}/${binding.currency}`;
    let ids = cache.get(cacheKey);
    if (ids === undefined) {
      const members: string[] = [];
      let after: string | null = null;
      const cursors = new Set<string>();
      while (true) {
        const data: Record<string, Schema.Json> = yield* admin.request(
          "SearchPricingMarket",
          "query SearchPricingMarket($id:ID!, $after:String) { market(id:$id) { status catalogs(first:250) { nodes { id status publication { id } priceList { currency } } pageInfo { hasNextPage } } conditions { conditionTypes companyLocationsCondition { applicationLevel companyLocations(first:250, after:$after) { nodes { id } pageInfo { hasNextPage endCursor } } } } } }",
          { after, id: binding.pricingMarketId }
        );
        const { market } = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            market: Schema.Struct({
              catalogs: Schema.Struct({
                nodes: Schema.Array(
                  Schema.Struct({
                    id: Schema.String,
                    priceList: Schema.NullOr(
                      Schema.Struct({ currency: Schema.String })
                    ),
                    publication: Schema.NullOr(
                      Schema.Struct({ id: Schema.String })
                    ),
                    status: Schema.String,
                  })
                ),
                pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
              }),
              conditions: Schema.Struct({
                companyLocationsCondition: Schema.Struct({
                  applicationLevel: Schema.String,
                  companyLocations: Schema.Struct({
                    nodes: Schema.Array(
                      Schema.Struct({
                        id: Schema.String.check(
                          Schema.isPattern(
                            /^gid:\/\/shopify\/CompanyLocation\/\d+$/u
                          )
                        ),
                      })
                    ),
                    pageInfo: Schema.Struct({
                      hasNextPage: Schema.Boolean,
                      endCursor: Schema.NullOr(Schema.String),
                    }),
                  }),
                }),
                conditionTypes: Schema.Array(Schema.String),
              }),
              status: Schema.String,
            }),
          })
        )(data);
        const catalog = market.catalogs.nodes.find(
          ({ id }) => id === binding.pricingCatalogId
        );
        const condition = market.conditions.companyLocationsCondition;
        if (
          market.status !== "ACTIVE" ||
          market.conditions.conditionTypes.length !== 1 ||
          market.conditions.conditionTypes[0] !== "COMPANY_LOCATION" ||
          condition.applicationLevel !== "SPECIFIC" ||
          market.catalogs.pageInfo.hasNextPage ||
          market.catalogs.nodes.length !== 1 ||
          catalog?.status !== "ACTIVE" ||
          catalog.publication !== null ||
          catalog.priceList?.currency !== binding.currency
        ) {
          return yield* new CommerceSearchIndexingFailure({
            message: `Pricing group ${binding.pricingGroupKey} requires one active price-only Market Catalog in ${binding.currency} with explicit company locations`,
            operation: "resolveIndexingContext",
          });
        }
        members.push(...condition.companyLocations.nodes.map(({ id }) => id));
        const page = condition.companyLocations.pageInfo;
        if (!page.hasNextPage) {
          break;
        }
        if (!page.endCursor || cursors.has(page.endCursor)) {
          return yield* new CommerceSearchIndexingFailure({
            message:
              "Shopify returned an invalid pricing group membership cursor",
            operation: "resolveIndexingContext",
          });
        }
        cursors.add(page.endCursor);
        after = page.endCursor;
      }
      ids = [...new Set(members)];
      cache.set(cacheKey, ids);
    }
    const existing = groups.find(
      (group) =>
        group.key === binding.pricingGroupKey &&
        group.storeKey === binding.storeKey &&
        group.locale === binding.locale
    );
    if (existing) {
      if (
        existing.marketId !== binding.pricingMarketId ||
        existing.currency !== binding.currency ||
        existing.catalogId !== binding.pricingCatalogId
      ) {
        return yield* new CommerceSearchIndexingFailure({
          message: "Ambiguous pricing group bindings",
          operation: "resolveIndexingContext",
        });
      }
      continue;
    }
    if (
      groups.some(
        (group) =>
          group.storeKey === binding.storeKey &&
          group.locale === binding.locale &&
          group.companyLocationIds.some((id) => ids.includes(id))
      )
    ) {
      return yield* new CommerceSearchIndexingFailure({
        message:
          "A company location belongs to multiple search pricing groups for the same Store/locale",
        operation: "resolveIndexingContext",
      });
    }
    groups.push({
      catalogId: binding.pricingCatalogId,
      companyLocationIds: ids,
      currency: binding.currency,
      key: binding.pricingGroupKey,
      locale: binding.locale,
      marketId: binding.pricingMarketId,
      storeKey: binding.storeKey,
    });
  }
  return groups;
});

/** Native context remains owned by Shopify; Algolia owns its ingestion resources. */
export const makeCommerceSearchIndexingSource = (
  fetchApi: typeof fetch = globalThis.fetch
) => ({
  create: (
    provider: Effect.Effect<ConfigProvider.ConfigProvider>,
    companyPricing = false
  ) =>
    Effect.gen(function* () {
      const domain = yield* Config.NonEmptyString("SHOPIFY_STORE_DOMAIN");
      if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(domain)) {
        return yield* new CommerceSearchIndexingFailure({
          message: "SHOPIFY_STORE_DOMAIN must be a myshopify.com hostname",
          operation: "resolveIndexingContext",
        });
      }
      const config = yield* provider;
      const admin = makeCatalogAdmin(
        yield* prepareAdminSettings(config, fetchApi),
        fetchApi
      );
      const data = yield* admin.request(
        "SearchShopContext",
        "query SearchShopContext { shop { currencyCode } }"
      );
      const { shop } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          shop: Schema.Struct({ currencyCode: Schema.NonEmptyString }),
        })
      )(data);
      const priceGroups = companyPricing
        ? yield* loadPriceGroups(
            admin,
            yield* Schema.decodeUnknownEffect(
              Schema.fromJsonString(ShopifyPurchasingPolicyBindings)
            )(
              yield* Config.String("SHOPIFY_COMPANY_PURCHASING_POLICIES").pipe(
                Config.withDefault("[]")
              )
            )
          )
        : undefined;
      const context = {
        contexts: shopifyConfiguration.stores.map((mapping) => ({
          ...mapping,
          currency: storeConfiguration.find(
            (store) =>
              store.storeKey === mapping.storeKey &&
              store.locale === mapping.locale
          )?.currency,
        })),
        domain,
        loadCategories: (locales: readonly string[]) =>
          loadSearchCategories(admin, locales).pipe(
            Effect.mapError((cause) =>
              cause._tag === "CommerceSearchIndexingFailure"
                ? cause
                : new CommerceSearchIndexingFailure({
                    cause,
                    message:
                      "Could not load Shopify collection labels. Check read_products and read_locales access.",
                    operation: "resolveIndexingContext",
                  })
            )
          ),
        shopCurrency: shop.currencyCode,
      };
      return priceGroups === undefined ? context : { ...context, priceGroups };
    }).pipe(
      Effect.provide(ConfigProvider.layer(provider)),
      Effect.mapError((cause) =>
        cause._tag === "CommerceSearchIndexingFailure"
          ? cause
          : new CommerceSearchIndexingFailure({
              cause,
              message:
                "Could not resolve Shopify search context. Check Shopify Admin credentials, read_products and read_locales access; company search also requires read_companies and read_markets.",
              operation: "resolveIndexingContext",
            })
      )
    ),
  storefronts: storeConfiguration,
});

export const commerceSearchIndexingSource = makeCommerceSearchIndexingSource();

/** B2B recipe adds explicitly bound shared pricing groups at provisioning time. */
export const withCompanySearchIndexing = (
  source: typeof commerceSearchIndexingSource
) => ({
  ...source,
  create: (provider: Effect.Effect<ConfigProvider.ConfigProvider>) =>
    source.create(provider, true),
});
