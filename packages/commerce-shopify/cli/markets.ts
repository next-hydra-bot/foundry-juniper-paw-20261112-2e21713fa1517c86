import { storeConfiguration } from "@repo/commerce-core/store";
import type { StoreConfiguration } from "@repo/commerce-core/store";
import {
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Redacted,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { shopifyAdminHttpClientLayer } from "../admin/http-client";
import { prepareAdminSettings } from "../admin/provisioning";
import { shopifyConfiguration, validateShopifyConfiguration } from "../store";
import type {
  ShopifyConfiguration,
  ShopifyMarketConfiguration,
} from "../store";

export class ShopifyMarketProvisioningError extends Schema.TaggedError<ShopifyMarketProvisioningError>()(
  "ShopifyMarketProvisioningError",
  { message: Schema.String }
) {}

const PageInfo = Schema.Struct({
  endCursor: Schema.NullOr(Schema.String),
  hasNextPage: Schema.Boolean,
});
const Market = Schema.Struct({
  conditions: Schema.NullOr(
    Schema.Struct({
      conditionTypes: Schema.Array(Schema.String),
      regionsCondition: Schema.NullOr(
        Schema.Struct({
          regions: Schema.Struct({
            nodes: Schema.Array(
              Schema.Struct({
                __typename: Schema.String,
                code: Schema.optional(Schema.String),
              })
            ),
            pageInfo: PageInfo,
          }),
        })
      ),
    })
  ),
  currencySettings: Schema.NullOr(
    Schema.Struct({
      baseCurrency: Schema.Struct({ currencyCode: Schema.String }),
      localCurrencies: Schema.Boolean,
    })
  ),
  handle: Schema.String,
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
});
type Market = typeof Market.Type;
const MarketsResponse = Schema.Struct({
  markets: Schema.Struct({ nodes: Schema.Array(Market), pageInfo: PageInfo }),
});
const MutationPayload = Schema.Struct({
  market: Schema.NullOr(Market),
  userErrors: Schema.Array(
    Schema.Struct({
      code: Schema.NullOr(Schema.String),
      message: Schema.String,
    })
  ),
});
const Envelope = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Json))
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.String }))
  ),
});
const RequestJson = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);

// Two markets per page keeps nested region reads under Shopify's query cost limit.
const marketFields = `id handle name status
  currencySettings { baseCurrency { currencyCode } localCurrencies }
  conditions { conditionTypes regionsCondition {
    regions(first:250) { nodes { __typename ... on MarketRegionCountry { code } } pageInfo { hasNextPage endCursor } }
  } }`;
const marketsQuery = `query ProvisioningMarkets($after:String) {
  markets(first:2,after:$after) { nodes { ${marketFields} } pageInfo { hasNextPage endCursor } }
}`;

type RequestedMarket = ShopifyMarketConfiguration;
export type MarketProvisioningChange = RequestedMarket &
  (
    | { readonly action: "create" }
    | { readonly action: "update" | "unchanged"; readonly id: string }
  );

const fail = (message: string) =>
  new ShopifyMarketProvisioningError({ message });
const countrySetMatches = (market: Market, desired: RequestedMarket) => {
  const { conditions } = market;
  const regions = conditions?.regionsCondition?.regions;
  return (
    conditions?.conditionTypes.length === 1 &&
    conditions.conditionTypes[0] === "REGION" &&
    regions !== undefined &&
    !regions.pageInfo.hasNextPage &&
    regions.nodes.length === desired.countries.length &&
    regions.nodes.every(
      (region) =>
        region.__typename === "MarketRegionCountry" &&
        region.code !== undefined &&
        desired.countries.some((country) => country === region.code)
    )
  );
};
const settingsMatch = (market: Market, desired: RequestedMarket) =>
  market.status === "ACTIVE" &&
  market.currencySettings?.baseCurrency.currencyCode === desired.currency &&
  !market.currencySettings.localCurrencies;

const requestedMarkets = (
  configuration: ShopifyConfiguration,
  stores: StoreConfiguration,
  storeKeys?: readonly string[]
) =>
  Effect.gen(function* () {
    yield* Effect.try({
      catch: (error) =>
        fail(
          error instanceof Error
            ? error.message
            : "Invalid Shopify configuration"
        ),
      try: () => {
        validateShopifyConfiguration(configuration, stores);
      },
    });
    const configuredKeys = new Set(
      stores.map(({ storeKey }) => String(storeKey))
    );
    if (
      storeKeys?.length === 0 ||
      storeKeys?.some((key) => !configuredKeys.has(key))
    ) {
      return yield* fail(
        `Select Store keys from the Store configuration: ${[...configuredKeys].join(", ")}`
      );
    }
    const marketKeys = new Set(
      configuration.stores
        .filter(
          ({ storeKey }) =>
            storeKeys === undefined || storeKeys.includes(storeKey)
        )
        .map(({ marketKey }) => marketKey)
    );
    if (marketKeys.size === 0) {
      return yield* fail("No Shopify Stores are configured for provisioning");
    }
    // A Store selects a whole declared Market, never a currency-derived group or a partial country set.
    return configuration.markets.filter(({ key }) => marketKeys.has(key));
  });

export class ShopifyMarkets extends Context.Service<
  ShopifyMarkets,
  {
    readonly provision: (options: {
      readonly storeKeys?: readonly string[];
      readonly dryRun: boolean;
    }) => Effect.Effect<
      readonly MarketProvisioningChange[],
      ShopifyMarketProvisioningError
    >;
  }
>()("@repo/commerce-shopify/ShopifyMarkets") {
  static readonly layerWith = ({
    domain,
    token,
    fetchApi = globalThis.fetch,
    configuration = shopifyConfiguration,
    stores = storeConfiguration,
  }: {
    readonly domain: string;
    readonly token:
      | Redacted.Redacted
      | Effect.Effect<Redacted.Redacted, ShopifyMarketProvisioningError>;
    readonly fetchApi?: typeof globalThis.fetch;
    readonly configuration?: ShopifyConfiguration;
    readonly stores?: StoreConfiguration;
  }) =>
    Layer.effect(
      ShopifyMarkets,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient;
        const request = Effect.fn("ShopifyMarkets.request")(function* (
          operation: string,
          query: string,
          variables: Record<string, Schema.Json>,
          writing: boolean
        ) {
          const accessToken = yield* Effect.isEffect(token)
            ? token
            : Effect.succeed(token);
          const requestBody = yield* Schema.encodeEffect(RequestJson)({
            query,
            variables,
          }).pipe(Effect.orDie);
          const response = yield* Effect.gen(function* () {
            const result = yield* http.execute(
              HttpClientRequest.post(
                `https://${domain}/admin/api/2026-10/graphql.json`
              ).pipe(
                HttpClientRequest.setHeader(
                  "x-shopify-access-token",
                  Redacted.value(accessToken)
                ),
                HttpClientRequest.bodyText(requestBody, "application/json")
              )
            );
            if (result.status < 200 || result.status >= 300) {
              return { body: undefined, status: result.status };
            }
            return { body: yield* result.json, status: result.status };
          }).pipe(
            Effect.timeout("30 seconds"),
            Effect.mapError(() =>
              fail(
                writing
                  ? `${operation}: write outcome unknown. Run provision --dry-run before retrying.`
                  : `${operation}: Shopify is unavailable`
              )
            )
          );
          if (response.body === undefined) {
            return yield* fail(
              `${operation}: Shopify returned HTTP ${response.status}. Check the Admin token and read_markets/write_markets scopes${writing && response.status >= 500 ? "; the write may have been applied" : ""}.`
            );
          }
          const envelope = yield* Schema.decodeUnknownEffect(Envelope)(
            response.body
          ).pipe(
            Effect.mapError(() =>
              fail(
                `${operation}: invalid Shopify response${writing ? "; the write may have been applied" : ""}`
              )
            )
          );
          if (envelope.errors !== undefined && envelope.errors.length > 0) {
            return yield* fail(
              `${operation}: ${envelope.errors.map(({ message }) => message).join("; ")}`
            );
          }
          if (!envelope.data) {
            return yield* fail(
              `${operation}: Shopify returned no data${writing ? "; the write may have been applied" : ""}`
            );
          }
          return envelope.data;
        });
        const readMarkets = Effect.gen(function* () {
          const markets: Market[] = [];
          const cursors = new Set<string>();
          let after: string | null = null;
          while (true) {
            const raw: Readonly<Record<string, Schema.Json>> = yield* request(
              "readMarkets",
              marketsQuery,
              { after },
              false
            );
            const page: typeof MarketsResponse.Type =
              yield* Schema.decodeUnknownEffect(MarketsResponse)(raw).pipe(
                Effect.mapError(() => fail("Invalid Shopify Markets response"))
              );
            markets.push(...page.markets.nodes);
            if (
              page.markets.nodes.some(
                (market) =>
                  market.conditions?.regionsCondition?.regions.pageInfo
                    .hasNextPage
              )
            ) {
              return yield* fail(
                "A Market has more than 250 regions; reconcile it before provisioning to avoid matching an incomplete country set"
              );
            }
            if (!page.markets.pageInfo.hasNextPage) {
              return markets;
            }
            const cursor: string | null = page.markets.pageInfo.endCursor;
            if (!cursor || cursors.has(cursor)) {
              return yield* fail("Shopify returned an invalid Markets cursor");
            }
            cursors.add(cursor);
            after = cursor;
          }
        });
        return ShopifyMarkets.of({
          provision: Effect.fn("ShopifyMarkets.provision")(function* ({
            storeKeys,
            dryRun,
          }) {
            const desired = yield* requestedMarkets(
              configuration,
              stores,
              storeKeys
            );
            const existing = yield* readMarkets;
            const changes: MarketProvisioningChange[] = [];
            // Resolve the complete plan before the first write.
            for (const target of desired) {
              const named = existing.find(
                (market) => market.handle === target.handle
              );
              const matches = existing.filter((market) =>
                countrySetMatches(market, target)
              );
              if (named && !countrySetMatches(named, target)) {
                return yield* fail(
                  `Market ${target.handle} already exists with different country conditions. Provision its full country set or reconcile it in Shopify.`
                );
              }
              if (!named && matches.length > 0) {
                return yield* fail(
                  `Market ${target.key} has countries already configured under ${matches.map(({ handle }) => handle).join(", ")}. Set its explicit handle in the Shopify configuration before provisioning.`
                );
              }
              if (matches.length > 1) {
                return yield* fail(
                  `Multiple Markets match ${target.countries.join(", ")}; reconcile overlapping Markets before provisioning`
                );
              }
              const current = named;
              changes.push(
                current === undefined
                  ? { ...target, action: "create" }
                  : {
                      ...target,
                      action: settingsMatch(current, target)
                        ? "unchanged"
                        : "update",
                      id: current.id,
                    }
              );
            }
            if (dryRun) {
              return changes;
            }
            for (const change of changes) {
              if (change.action === "unchanged") {
                continue;
              }
              const operation =
                change.action === "create" ? "marketCreate" : "marketUpdate";
              const currencySettings = {
                baseCurrency: change.currency,
                localCurrencies: false,
              };
              const variables: Record<string, Schema.Json> =
                change.action === "create"
                  ? {
                      input: {
                        conditions: {
                          regionsCondition: {
                            regions: change.countries.map((countryCode) => ({
                              countryCode,
                            })),
                          },
                        },
                        currencySettings,
                        handle: change.handle,
                        name: change.name,
                        status: "ACTIVE",
                      },
                    }
                  : {
                      id: change.id,
                      input: { currencySettings, status: "ACTIVE" },
                    };
              const query =
                change.action === "create"
                  ? `mutation ProvisionMarket($input:MarketCreateInput!) { marketCreate(input:$input) { market { ${marketFields} } userErrors { code message } } }`
                  : `mutation ProvisionMarket($id:ID!,$input:MarketUpdateInput!) { marketUpdate(id:$id,input:$input) { market { ${marketFields} } userErrors { code message } } }`;
              const raw = yield* request(operation, query, variables, true);
              const payload = yield* Schema.decodeUnknownEffect(
                MutationPayload
              )(raw[operation]).pipe(
                Effect.mapError(() =>
                  fail(
                    `${operation}: invalid result; run provision --dry-run before retrying`
                  )
                )
              );
              if (payload.userErrors.length) {
                const messages = payload.userErrors.map(({ code, message }) =>
                  code ? `${code}: ${message}` : message
                );
                if (
                  payload.userErrors.some(
                    ({ code }) => code === "MULTIPLE_CURRENCIES_NOT_SUPPORTED"
                  )
                ) {
                  messages.push(
                    "Activate Shopify Payments or a supported Adyen setup before provisioning multiple currencies."
                  );
                }
                return yield* fail(`${operation}: ${messages.join("; ")}`);
              }
              if (
                !payload.market ||
                !countrySetMatches(payload.market, change) ||
                !settingsMatch(payload.market, change)
              ) {
                return yield* fail(
                  `${operation}: returned Market does not match the requested countries, currency and active status`
                );
              }
            }
            return changes;
          }),
        });
      })
    ).pipe(Layer.provide(shopifyAdminHttpClientLayer(fetchApi)));

  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const domain = yield* Config.schema(
        Schema.String.check(
          Schema.isPattern(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u)
        ),
        "SHOPIFY_STORE_DOMAIN"
      );
      const settings = yield* prepareAdminSettings(
        yield* ConfigProvider.ConfigProvider
      );
      const token = settings.pipe(
        Effect.map((credentials) => Redacted.make(credentials.token)),
        Effect.mapError(
          (error) =>
            new ShopifyMarketProvisioningError({ message: error.message })
        )
      );
      return ShopifyMarkets.layerWith({ domain, token });
    })
  );
}
