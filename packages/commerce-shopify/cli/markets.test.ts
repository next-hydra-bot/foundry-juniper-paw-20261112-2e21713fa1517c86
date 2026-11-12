import { describe, expect, it } from "@effect/vitest";
import {
  CommerceLocale,
  StoreKey,
  storeConfiguration,
} from "@repo/commerce-core/store";
import type { StoreConfiguration } from "@repo/commerce-core/store";
import { ConfigProvider, Effect, Redacted, Schema } from "effect";
import { afterEach, vi } from "vitest";

import { shopifyConfiguration } from "../store";
import type { ShopifyConfiguration } from "../store";
import { ShopifyMarkets } from "./markets";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const market = (
  handle: string,
  countries: readonly string[],
  currency: string,
  status = "ACTIVE"
) => ({
  conditions: {
    conditionTypes: ["REGION"],
    regionsCondition: {
      regions: {
        nodes: countries.map((code) => ({
          __typename: "MarketRegionCountry",
          code,
        })),
        pageInfo: { endCursor: null, hasNextPage: false },
      },
    },
  },
  currencySettings: {
    baseCurrency: { currencyCode: currency },
    localCurrencies: false,
  },
  handle,
  id: `gid://shopify/Market/${handle}`,
  name: handle,
  status,
});
const RequestJson = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Struct({
      after: Schema.optional(Schema.NullOr(Schema.String)),
      id: Schema.optional(Schema.String),
      input: Schema.optional(
        Schema.Struct({
          conditions: Schema.optional(
            Schema.Struct({
              regionsCondition: Schema.Struct({
                regions: Schema.Array(
                  Schema.Struct({ countryCode: Schema.String })
                ),
              }),
            })
          ),
          currencySettings: Schema.Struct({
            baseCurrency: Schema.String,
            localCurrencies: Schema.Boolean,
          }),
          handle: Schema.optional(Schema.String),
          name: Schema.optional(Schema.String),
          status: Schema.String,
        })
      ),
    }),
  })
);

const fixture = (
  initial: ReturnType<typeof market>[] = [],
  writeFailure?: string,
  configuration: ShopifyConfiguration = shopifyConfiguration,
  stores: StoreConfiguration = storeConfiguration
) => {
  const remote = [...initial];
  const reads: (string | null)[] = [];
  const writes: string[] = [];
  const fetchApi: typeof globalThis.fetch = async (url, init) => {
    const received = new Request(url, init);
    expect(received.url).toBe(
      "https://example.myshopify.com/admin/api/2026-10/graphql.json"
    );
    expect(received.headers.get("X-Shopify-Access-Token")).toBe("admin-token");
    const request = Schema.decodeSync(RequestJson)(await received.text());
    if (request.query.includes("query ProvisioningMarkets")) {
      const after = request.variables.after ?? null;
      reads.push(after);
      const offset = after === null ? 0 : Number(after);
      return Response.json({
        data: {
          markets: {
            nodes: remote.slice(offset, offset + 2),
            pageInfo: {
              endCursor: String(offset + 2),
              hasNextPage: offset + 2 < remote.length,
            },
          },
        },
      });
    }
    const operation = request.query.includes("marketCreate(")
      ? "marketCreate"
      : "marketUpdate";
    writes.push(operation);
    if (writeFailure === "unknown") {
      throw new Error("Connection closed after write");
    }
    if (writeFailure) {
      return Response.json({
        data: {
          [operation]: {
            market: null,
            userErrors: [
              {
                code: writeFailure,
                message: "Currency configuration rejected",
              },
            ],
          },
        },
      });
    }
    const { input } = request.variables;
    if (input === undefined) {
      throw new Error("Missing Market input");
    }
    const current =
      operation === "marketUpdate"
        ? remote.find(({ id }) => id === request.variables.id)
        : undefined;
    const countries =
      current?.conditions.regionsCondition.regions.nodes.map(
        ({ code }) => code
      ) ??
      input.conditions?.regionsCondition.regions.map(
        ({ countryCode }) => countryCode
      );
    const handle = current?.handle ?? input.handle;
    if (countries === undefined || handle === undefined) {
      throw new Error("Missing Market identity");
    }
    const result = {
      ...market(
        handle,
        countries,
        input.currencySettings.baseCurrency,
        input.status
      ),
      currencySettings: {
        baseCurrency: { currencyCode: input.currencySettings.baseCurrency },
        localCurrencies: input.currencySettings.localCurrencies,
      },
    };
    if (current === undefined) {
      remote.push(result);
    } else {
      remote.splice(remote.indexOf(current), 1, result);
    }
    return Response.json({
      data: { [operation]: { market: result, userErrors: [] } },
    });
  };
  return {
    fetchApi,
    layer: ShopifyMarkets.layerWith({
      configuration,
      domain: "example.myshopify.com",
      fetchApi,
      stores,
      token: Redacted.make("admin-token"),
    }),
    reads,
    remote,
    writes,
  };
};

const provision = (
  target: ReturnType<typeof fixture>,
  dryRun: boolean,
  storeKeys?: readonly string[]
) =>
  ShopifyMarkets.pipe(
    Effect.flatMap((service) => service.provision({ dryRun, storeKeys })),
    Effect.provide(target.layer)
  );

describe("Shopify Market provisioning", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.effect(
    "uses client credentials through the default provisioning Layer",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        let acquisitions = 0;
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof fetch>(async (input, init) => {
            const request = new Request(input, init);
            if (request.url.endsWith("/admin/oauth/access_token")) {
              expect(
                new URLSearchParams(await request.text()).get("grant_type")
              ).toBe("client_credentials");
              acquisitions += 1;
              return Response.json({
                access_token: "admin-token",
                expires_in: 3600,
              });
            }
            expect(request.headers.get("x-shopify-access-token")).toBe(
              "admin-token"
            );
            return await target.fetchApi(input, init);
          })
        );
        yield* ShopifyMarkets.pipe(
          Effect.flatMap((service) => service.provision({ dryRun: true })),
          Effect.provide(ShopifyMarkets.layer),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              SHOPIFY_ADMIN_CLIENT_ID: "client",
              SHOPIFY_ADMIN_CLIENT_SECRET: "secret",
              SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
            })
          )
        );
        expect(acquisitions).toBe(1);
        expect(target.writes).toEqual([]);
      })
  );
  it.effect("plans the explicitly declared Markets without any writes", () =>
    Effect.gen(function* () {
      const target = fixture();
      const plan = yield* provision(target, true);
      expect(plan).toEqual(
        shopifyConfiguration.markets.map((configured) => ({
          ...configured,
          action: "create",
        }))
      );
      expect(target.writes).toEqual([]);
    })
  );

  it.effect(
    "keeps distinct same-currency Markets and provisions an entire shared Market for a selected Store",
    () =>
      Effect.gen(function* () {
        const configuration: ShopifyConfiguration = {
          markets: [
            {
              countries: ["FR", "ES"],
              currency: "EUR",
              handle: "west",
              key: "west",
              name: "West",
            },
            {
              countries: ["DE"],
              currency: "EUR",
              handle: "central",
              key: "central",
              name: "Central",
            },
          ],
          stores: [
            {
              country: "FR",
              language: "EN",
              locale: CommerceLocale.make("en-US"),
              marketKey: "west",
              storeKey: StoreKey.make("retail"),
            },
            {
              country: "DE",
              language: "EN",
              locale: CommerceLocale.make("en-US"),
              marketKey: "central",
              storeKey: StoreKey.make("trade"),
            },
          ],
        };
        const stores: StoreConfiguration = [
          {
            currency: "EUR",
            isDefault: true,
            locale: CommerceLocale.make("en-US"),
            storeKey: StoreKey.make("retail"),
          },
          {
            currency: "EUR",
            isDefault: false,
            locale: CommerceLocale.make("en-US"),
            storeKey: StoreKey.make("trade"),
          },
        ];
        const target = fixture([], undefined, configuration, stores);
        const plan = yield* provision(target, true);
        expect(plan.map(({ key }) => key)).toEqual(["west", "central"]);
        const selected = yield* provision(target, false, ["retail"]);
        expect(selected).toEqual([
          { ...configuration.markets[0], action: "create" },
        ]);
        expect(
          target.remote[0]?.conditions.regionsCondition.regions.nodes.map(
            ({ code }) => code
          )
        ).toEqual(["FR", "ES"]);
        expect(
          target.remote[0]?.currencySettings.baseCurrency.currencyCode
        ).toBe("EUR");
      })
  );

  it.effect(
    "rejects inconsistent mappings before reading or writing Shopify",
    () =>
      Effect.gen(function* () {
        const configuration: ShopifyConfiguration = {
          ...shopifyConfiguration,
          markets: shopifyConfiguration.markets.map((configured) => ({
            ...configured,
            currency: "CAD",
          })),
        };
        const target = fixture([], undefined, configuration);
        const error = yield* provision(target, false).pipe(Effect.flip);
        expect(error.message).toContain("declared country and currency");
        expect(target.reads).toEqual([]);
        expect(target.writes).toEqual([]);
      })
  );

  it.effect(
    "reuses explicitly configured Markets, updates exact matches, and converges on reruns",
    () =>
      Effect.gen(function* () {
        const target = fixture([
          market("us", ["US"], "USD"),
          market("united-kingdom", ["GB"], "USD", "DRAFT"),
        ]);
        const first = yield* provision(target, false);
        expect(first.map(({ action }) => action)).toEqual([
          "unchanged",
          "update",
          "create",
        ]);
        expect(
          target.remote.find(({ handle }) => handle === "united-kingdom")
            ?.currencySettings.baseCurrency.currencyCode
        ).toBe("GBP");
        const second = yield* provision(target, false);
        expect(
          second.every(({ action }) => action === "unchanged")
        ).toBeTruthy();
        expect(target.writes).toEqual(["marketUpdate", "marketCreate"]);
        expect(target.reads).toEqual([null, null, "2"]);
      })
  );

  it.effect(
    "provisions all declared Markets for a Store across its configured locales",
    () =>
      Effect.gen(function* () {
        const existing = market("canada", ["CA"], "CAD");
        const target = fixture([existing]);
        const changes = yield* provision(target, false, ["default-store"]);
        expect(changes.map(({ key }) => key)).toEqual([
          "north-america",
          "europe",
        ]);
        expect(target.remote).toContainEqual(existing);
        expect(target.writes).toEqual(["marketCreate", "marketCreate"]);
      })
  );

  it.effect("rejects unknown Store keys before making a Shopify request", () =>
    Effect.gen(function* () {
      const target = fixture();
      const error = yield* provision(target, false, ["CA"]).pipe(Effect.flip);
      expect(error.message).toContain("Store configuration");
      expect(target.reads).toEqual([]);
      expect(target.writes).toEqual([]);
    })
  );

  it.effect(
    "resolves conflicting handles before any planned write is applied",
    () =>
      Effect.gen(function* () {
        const target = fixture([market("united-kingdom", ["CA"], "CAD")]);
        const error = yield* provision(target, false).pipe(Effect.flip);
        expect(error.message).toContain("different country conditions");
        expect(target.writes).toEqual([]);
      })
  );

  it.effect(
    "requires an explicit native handle instead of adopting a country match",
    () =>
      Effect.gen(function* () {
        const target = fixture([
          market("first", ["US"], "USD"),
          market("second", ["US"], "USD"),
        ]);
        const error = yield* provision(target, false, ["default-store"]).pipe(
          Effect.flip
        );
        expect(error.message).toContain("Set its explicit handle");
        expect(target.writes).toEqual([]);
      })
  );

  it.effect(
    "rejects duplicate country matches even when the declared handle exists",
    () =>
      Effect.gen(function* () {
        const target = fixture([
          market("us", ["US"], "USD"),
          market("other", ["US"], "CAD"),
        ]);
        const error = yield* provision(target, false, ["default-store"]).pipe(
          Effect.flip
        );
        expect(error.message).toContain("overlapping Markets");
        expect(target.writes).toEqual([]);
      })
  );

  it.effect(
    "reports the payment-provider prerequisite when Shopify rejects multiple currencies",
    () =>
      Effect.gen(function* () {
        const target = fixture([], "MULTIPLE_CURRENCIES_NOT_SUPPORTED");
        const error = yield* provision(target, false, ["de-fr-uk"]).pipe(
          Effect.flip
        );
        expect(error.message).toContain("Shopify Payments");
        expect(error.message).toContain("Adyen");
        expect(error.message).not.toContain("admin-token");
        expect(target.writes).toEqual(["marketCreate"]);
      })
  );

  it.effect(
    "never automatically retries a Market write with an unknown outcome",
    () =>
      Effect.gen(function* () {
        const target = fixture([], "unknown");
        const error = yield* provision(target, false, ["default-store"]).pipe(
          Effect.flip
        );
        expect(error.message).toContain("write outcome unknown");
        expect(error.message).toContain("--dry-run");
        expect(target.writes).toEqual(["marketCreate"]);
      })
  );

  it.effect("refuses to match a truncated region list", () =>
    Effect.gen(function* () {
      const existing = market("incomplete", ["US"], "USD");
      existing.conditions.regionsCondition.regions.pageInfo.hasNextPage = true;
      const target = fixture([existing]);
      const error = yield* provision(target, false).pipe(Effect.flip);
      expect(error.message).toContain("incomplete country set");
      expect(target.writes).toEqual([]);
    })
  );
});
