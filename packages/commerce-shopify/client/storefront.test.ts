import { it } from "@effect/vitest";
import { AnonymousCommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { gql } from "@shopify/hydrogen";
import { Effect, Layer, Schema } from "effect";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  vi,
} from "vitest";

import { keys } from "../keys";
import { guestCommerceContextLayer } from "../testing/commerce-context";
import { ShopifyStorefrontClient } from "./storefront";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const query =
  gql(`query Example($country: CountryCode!, $language: LanguageCode!)
  @inContext(country: $country, language: $language) { shop { name } }`);
const store = resolveStore(
  { locale: CommerceLocale.make("en-US") },
  storeConfiguration
);
const context = guestCommerceContextLayer(
  new AnonymousCommerceContextRequest({ store })
);
const incoming = () =>
  new Headers({
    cookie:
      "site-auth=private-auth; shopify-cart=private-cart; _shopify_essential=shopify-session",
    "sec-gpc": "1",
    "x-forwarded-for": "198.51.100.1",
    "x-vercel-forwarded-for": "192.0.2.1",
  });
const execute = (requestHeaders = Effect.sync(incoming)) =>
  ShopifyStorefrontClient.pipe(
    Effect.flatMap((client) =>
      client.execute(
        async (sdk, signal) => await sdk.graphql(query, { signal })
      )
    ),
    Effect.provide(
      ShopifyStorefrontClient.layerWith({ environment: keys(), requestHeaders })
    ),
    Effect.provide(context)
  );

describe("Hydrogen Storefront integration", () => {
  beforeEach(() => {
    vi.stubEnv("SHOPIFY_STORE_DOMAIN", "example.myshopify.com");
    vi.stubEnv("SHOPIFY_STOREFRONT_PRIVATE_TOKEN", "private-test-token");
    vi.stubEnv("SHOPIFY_STOREFRONT_API_VERSION", "2026-10");
    vi.stubEnv("SHOPIFY_BUYER_IP_HEADER", "x-vercel-forwarded-for");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.effect(
    "supports public catalog reads without buyer context in production",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("NODE_ENV", "production");
        const fetch = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(
            new Response('{"data":{"shop":{"name":"Public catalog"}}}')
          );
        const data = yield* ShopifyStorefrontClient.pipe(
          Effect.flatMap((client) =>
            client.execute(async (sdk, signal) => {
              const response = await sdk.graphql(query, { signal });
              return response;
            })
          ),
          Effect.provide(
            ShopifyStorefrontClient.layerWith({
              environment: keys(),
              requestHeaders: Effect.succeed(
                new Headers({ "x-request-id": "" })
              ),
              requireBuyerIp: false,
            })
          ),
          Effect.provide(context)
        );
        const sent = new Headers(fetch.mock.calls[0]?.[1]?.headers);
        expect(data.shop.name).toBe("Public catalog");
        expect(sent.get("shopify-storefront-buyer-ip")).toBeNull();
        expect(sent.get("cookie")).toBeNull();
        expect(sent.get("shopify-storefront-private-token")).toBe(
          "private-test-token"
        );
      })
  );

  it.effect(
    "retains inferred result types and sends private credentials, trusted buyer IP and market context",
    () =>
      Effect.gen(function* () {
        const fetch = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValue(
            new Response('{"data":{"shop":{"name":"Example"}}}')
          );
        const data = yield* execute();
        expectTypeOf(data.shop.name).toEqualTypeOf<string>();
        const [url, init] = fetch.mock.calls[0] ?? [];
        const sent = new Headers(init?.headers);
        expect({
          cache: init?.cache,
          cookie: sent.get("cookie"),
          data,
          ip: sent.get("Shopify-Storefront-Buyer-IP"),
          privacy: sent.get("sec-gpc"),
          token: sent.get("Shopify-Storefront-Private-Token"),
          url,
        }).toEqual({
          cache: "no-store",
          cookie: "_shopify_essential=shopify-session",
          data: { shop: { name: "Example" } },
          ip: "192.0.2.1",
          privacy: "1",
          token: "private-test-token",
          url: "https://example.myshopify.com/api/2026-10/graphql.json",
        });
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(init?.body).toContain('"country":"US"');
        expect(init?.body).toContain('"language":"EN"');
      })
  );

  for (const { body, status, reason, label } of [
    {
      body: '{"errors":[{"message":"Rejected"}]}',
      label: "GraphQL rejection",
      reason: "rejected",
      status: 200,
    },
    {
      body: "invalid json",
      label: "invalid JSON",
      reason: "invalidResponse",
      status: 200,
    },
    {
      body: "{}",
      label: "missing data",
      reason: "invalidResponse",
      status: 200,
    },
    {
      body: '{"errors":"invalid"}',
      label: "malformed GraphQL errors",
      reason: "invalidResponse",
      status: 200,
    },
    {
      body: "private-test-token",
      label: "HTTP rejection",
      reason: "rejected",
      status: 403,
    },
    { body: "", label: "HTTP outage", reason: "unavailable", status: 503 },
    {
      body: '{"errors":[{"message":"Throttled","extensions":{"code":"THROTTLED"}}]}',
      label: "GraphQL throttling",
      reason: "unavailable",
      status: 200,
    },
    {
      body: '{"errors":[{"message":"Error","extensions":{"code":"INTERNAL_SERVER_ERROR"}}]}',
      label: "GraphQL outage",
      reason: "unavailable",
      status: 200,
    },
  ]) {
    it.effect(
      `classifies ${label} without leaking credentials or replaying the request`,
      () =>
        Effect.gen(function* () {
          const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response(body, { status }));
          const result = yield* execute().pipe(Effect.result);
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "ShopifyRequestFailure", reason },
          });
          expect(JSON.stringify(result)).not.toContain("private-test-token");
          expect(fetch).toHaveBeenCalledOnce();
        })
    );
  }

  it.effect(
    "retains safe GraphQL error codes without copying provider messages or credentials",
    () =>
      Effect.gen(function* () {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          Response.json({
            errors: [
              {
                extensions: {
                  code: "fragmentNotUnique",
                  requiredAccess:
                    "`unauthenticated_read_product_inventory` access scope.",
                },
                message: "Query with private-test-token was rejected",
              },
              {
                extensions: { code: "private-test-token" },
                message: "Unsafe error code",
              },
            ],
          })
        );
        const result = yield* execute().pipe(Effect.result);
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            codes: ["fragmentNotUnique"],
            reason: "rejected",
            requiredScopes: ["unauthenticated_read_product_inventory"],
          },
        });
        const serialized = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown)
        )(result);
        expect(serialized).not.toContain("private-test-token");
        expect(serialized).not.toContain("Query with");
      })
  );

  it.effect("does not retry a cart mutation after a network failure", () =>
    Effect.gen(function* () {
      const mutation = gql(`mutation Create { cartCreate { cart { id } } }`);
      const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new TypeError("Network failed"));
      const clientLayer = ShopifyStorefrontClient.layerWith({
        environment: keys(),
        requestHeaders: Effect.sync(incoming),
      });
      const result = yield* ShopifyStorefrontClient.pipe(
        Effect.flatMap((client) =>
          client.execute(
            async (sdk, signal) => await sdk.graphql(mutation, { signal })
          )
        ),
        Effect.provide(Layer.merge(context, clientLayer)),
        Effect.result
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { reason: "unavailable" },
      });
      expect(fetch).toHaveBeenCalledOnce();
    })
  );

  it.effect(
    "rejects production requests without a trusted buyer IP instead of accepting generic forwarded headers",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("NODE_ENV", "production");
        const fetch = vi.spyOn(globalThis, "fetch");
        const result = yield* execute(
          Effect.succeed(new Headers({ "x-forwarded-for": "198.51.100.1" }))
        ).pipe(Effect.result);
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { reason: "rejected" },
        });
        expect(fetch).not.toHaveBeenCalled();
      })
  );

  it.effect(
    "resolves buyer and market anew when the stable provider is reused",
    () =>
      Effect.gen(function* () {
        let requestHeaders = incoming();
        const fetch = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(
            new Response('{"data":{"shop":{"name":"Example"}}}')
          )
          .mockResolvedValueOnce(
            new Response('{"data":{"shop":{"name":"Example"}}}')
          );
        const clientLayer = ShopifyStorefrontClient.layerWith({
          environment: keys(),
          requestHeaders: Effect.sync(() => requestHeaders),
        });
        const program = ShopifyStorefrontClient.pipe(
          Effect.flatMap((client) =>
            client.execute(
              async (sdk, signal) => await sdk.graphql(query, { signal })
            )
          ),
          Effect.provide(clientLayer)
        );
        yield* program.pipe(Effect.provide(context));
        requestHeaders = new Headers({
          cookie: "_shopify_essential=second-session",
          "x-vercel-forwarded-for": "192.0.2.2",
        });
        const frenchStore = resolveStore(
          { locale: CommerceLocale.make("fr-FR") },
          storeConfiguration
        );
        yield* program.pipe(
          Effect.provide(
            guestCommerceContextLayer(
              new AnonymousCommerceContextRequest({ store: frenchStore })
            )
          )
        );
        const [, second] = fetch.mock.calls[1] ?? [];
        expect(
          new Headers(second?.headers).get("Shopify-Storefront-Buyer-IP")
        ).toBe("192.0.2.2");
        expect(new Headers(second?.headers).get("cookie")).toBe(
          "_shopify_essential=second-session"
        );
        expect(second?.body).toContain('"country":"FR"');
        expect(second?.body).toContain('"language":"FR"');
      })
  );
});
