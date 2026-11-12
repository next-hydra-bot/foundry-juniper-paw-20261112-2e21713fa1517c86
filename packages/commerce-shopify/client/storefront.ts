import "server-only";
import { isIP } from "node:net";

import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import {
  createShopifyRequestContext,
  createStorefrontClient,
  StorefrontApiError,
} from "@shopify/hydrogen";
import type {
  GraphQLFormattedError,
  StorefrontClient,
} from "@shopify/hydrogen";
import { Context, Effect, Layer, Schema } from "effect";
import { headers } from "next/headers";

import { keys } from "../keys";
import { storefrontContext } from "../store";

export class ShopifyRequestFailure extends Schema.TaggedError<ShopifyRequestFailure>()(
  "ShopifyRequestFailure",
  {
    codes: Schema.optionalKey(Schema.Array(Schema.String)),
    reason: Schema.Literals(["unavailable", "rejected", "invalidResponse"]),
    requiredScopes: Schema.optionalKey(Schema.Array(Schema.String)),
  }
) {}

/** Native SDK calls retain query-specific variables and result inference. */
type ShopifyQuery<A> = (
  client: StorefrontClient,
  signal: AbortSignal
) => Promise<{
  readonly data: A | null;
  readonly errors?: readonly GraphQLFormattedError[];
}>;

const GraphqlErrors = Schema.Array(
  Schema.Struct({
    extensions: Schema.optional(
      Schema.Struct({
        code: Schema.optional(Schema.String),
        requiredAccess: Schema.optional(Schema.String),
      })
    ),
    message: Schema.String,
  })
);

export class ShopifyStorefrontClient extends Context.Service<
  ShopifyStorefrontClient,
  {
    readonly execute: <A>(
      query: ShopifyQuery<A>
    ) => Effect.Effect<A, ShopifyRequestFailure, CommerceContext>;
    readonly storeDomain: string;
  }
>()("@repo/commerce-shopify/StorefrontClient") {
  /** Supply the request adapter and transport without changing the typed SDK interface. */
  static readonly layerWith = ({
    environment,
    requestHeaders,
    fetchApi = globalThis.fetch,
    requireBuyerIp = true,
  }: {
    readonly environment: ReturnType<typeof keys>;
    readonly requestHeaders: Effect.Effect<Headers>;
    readonly fetchApi?: typeof globalThis.fetch;
    /** Public, shared catalog reads have no originating buyer request. */
    readonly requireBuyerIp?: boolean;
  }) =>
    Layer.sync(ShopifyStorefrontClient, () =>
      ShopifyStorefrontClient.of({
        execute: <A>(query: ShopifyQuery<A>) =>
          Effect.gen(function* () {
            const { store } = yield* CommerceContext;
            const incoming = yield* requestHeaders;
            const forwardedIp = incoming
              .get(environment.SHOPIFY_BUYER_IP_HEADER)
              ?.split(",")[0]
              ?.trim();
            const buyerIp = requireBuyerIp
              ? (forwardedIp ??
                (process.env.NODE_ENV === "production"
                  ? undefined
                  : "127.0.0.1"))
              : undefined;
            if (requireBuyerIp && (!buyerIp || isIP(buyerIp) === 0)) {
              return yield* new ShopifyRequestFailure({ reason: "rejected" });
            }
            // Shopify does not need the site's auth or private cart cookies.
            const shopifyCookies = incoming
              .get("cookie")
              ?.split(";")
              .map((part) => part.trim())
              .filter(
                (part) =>
                  part.startsWith("_shopify_") ||
                  part.startsWith("_tracking_consent=")
              );
            const shopifyHeaders = new Headers(incoming);
            shopifyHeaders.delete("cookie");
            if ((shopifyCookies?.length ?? 0) > 0) {
              shopifyHeaders.set("cookie", shopifyCookies?.join("; ") ?? "");
            }
            const context = {
              i18n: storefrontContext(store),
              request: { headers: shopifyHeaders },
            };
            const config = {
              apiVersion: environment.SHOPIFY_STOREFRONT_API_VERSION,
              fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
                await fetchApi(input, { ...init, cache: "no-store" }),
              privateStorefrontToken:
                environment.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
              storeDomain: environment.SHOPIFY_STORE_DOMAIN,
            };
            const client =
              buyerIp === undefined
                ? createStorefrontClient({
                    config,
                    requestContext: createShopifyRequestContext(context),
                    type: "private_no_buyer_context",
                  })
                : createStorefrontClient({
                    config,
                    requestContext: createShopifyRequestContext({
                      ...context,
                      buyerIp,
                    }),
                    type: "private",
                  });
            const response = yield* Effect.tryPromise({
              catch: (error) => {
                if (
                  error instanceof StorefrontApiError &&
                  error.status !== undefined
                ) {
                  if (error.status === 429 || error.status >= 500) {
                    return new ShopifyRequestFailure({ reason: "unavailable" });
                  }
                  return new ShopifyRequestFailure({
                    reason:
                      error.status >= 400 ? "rejected" : "invalidResponse",
                  });
                }
                return new ShopifyRequestFailure({ reason: "unavailable" });
              },
              try: async (signal) => await query(client, signal),
            });
            const errors =
              response.errors === undefined
                ? []
                : yield* Schema.decodeEffect(GraphqlErrors)(
                    response.errors
                  ).pipe(
                    Effect.mapError(
                      () =>
                        new ShopifyRequestFailure({ reason: "invalidResponse" })
                    )
                  );
            if (errors.length) {
              const requiredScopes = [
                ...new Set(
                  errors.flatMap(
                    ({ extensions }) =>
                      extensions?.requiredAccess?.match(
                        /\bunauthenticated_(?:read|write)_[a-z_]+\b/gu
                      ) ?? []
                  )
                ),
              ];
              const codes = [
                ...new Set(
                  errors.flatMap(({ extensions }) => {
                    const code = extensions?.code;
                    return code &&
                      /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u.test(code) &&
                      !code.includes(
                        environment.SHOPIFY_STOREFRONT_PRIVATE_TOKEN
                      )
                      ? [code]
                      : [];
                  })
                ),
              ];
              const unavailable = errors.some(
                (error) =>
                  error.extensions?.code === "THROTTLED" ||
                  error.extensions?.code === "INTERNAL_SERVER_ERROR"
              );
              return yield* new ShopifyRequestFailure({
                codes,
                reason: unavailable ? "unavailable" : "rejected",
                requiredScopes,
              });
            }
            if (response.data === undefined || response.data === null) {
              return yield* new ShopifyRequestFailure({
                reason: "invalidResponse",
              });
            }
            return response.data;
          }),
        storeDomain: environment.SHOPIFY_STORE_DOMAIN,
      })
    );

  static readonly layer = Layer.suspend(() =>
    ShopifyStorefrontClient.layerWith({
      environment: keys(),
      requestHeaders: Effect.promise(async () => new Headers(await headers())),
    })
  );
}
