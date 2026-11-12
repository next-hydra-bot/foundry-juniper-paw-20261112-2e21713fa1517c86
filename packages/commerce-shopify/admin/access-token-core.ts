import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { Cache, Clock, Duration, Effect, Exit, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { shopifyAdminHttpClientLayer } from "./http-client";
import type { ShopifyAdminEnvironment } from "./keys";

const Configuration = Schema.Struct({
  SHOPIFY_ADMIN_ACCESS_TOKEN: Schema.optional(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  SHOPIFY_ADMIN_CLIENT_ID: Schema.optional(Schema.NonEmptyString),
  SHOPIFY_ADMIN_CLIENT_SECRET: Schema.optional(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  SHOPIFY_STORE_DOMAIN: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u)
  ),
});
const TokenResponse = Schema.Struct({
  access_token: Schema.RedactedFromValue(Schema.NonEmptyString),
  expires_in: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER / 1000)
  ),
});
const configurationError = () =>
  new Error(
    "Configure Shopify Admin access with either SHOPIFY_ADMIN_ACCESS_TOKEN or both SHOPIFY_ADMIN_CLIENT_ID and SHOPIFY_ADMIN_CLIENT_SECRET, and a valid SHOPIFY_STORE_DOMAIN."
  );
const authenticationUnavailable = () =>
  new CommerceAccountUnavailable({
    message:
      "Shopify Admin authentication is unavailable. Check the app credentials and installation.",
  });

/** Shared by runtime Layers and provisioning; acquisition stays lazy. */
export const makeShopifyAdminAccessToken = (
  environment: ShopifyAdminEnvironment,
  fetchApi: typeof fetch = globalThis.fetch
) =>
  Effect.gen(function* () {
    const config = yield* Schema.decodeEffect(Configuration)(environment).pipe(
      Effect.mapError(configurationError)
    );
    const supplied = config.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const clientId = config.SHOPIFY_ADMIN_CLIENT_ID;
    const clientSecret = config.SHOPIFY_ADMIN_CLIENT_SECRET;
    if (supplied !== undefined) {
      if (clientId !== undefined || clientSecret !== undefined) {
        return yield* Effect.fail(configurationError());
      }
      return {
        get: Effect.succeed(supplied),
        invalidate: () => Effect.void,
      };
    }
    if (clientId === undefined || clientSecret === undefined) {
      return yield* Effect.fail(configurationError());
    }
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);

    const acquire = Effect.gen(function* () {
      const startedAt = yield* Clock.currentTimeMillis;
      const response = yield* http.execute(
        HttpClientRequest.post(
          `https://${config.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`
        ).pipe(
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            grant_type: "client_credentials",
          })
        )
      );
      const result =
        yield* HttpClientResponse.schemaBodyJson(TokenResponse)(response);
      const completedAt = yield* Clock.currentTimeMillis;
      const lifetime = result.expires_in * 1000;
      const timeToLive =
        lifetime - (completedAt - startedAt) - Math.min(60_000, lifetime / 10);
      if (timeToLive <= 0) {
        return yield* authenticationUnavailable();
      }
      return { timeToLive, token: result.access_token };
    }).pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError(authenticationUnavailable)
    );
    const cache = yield* Cache.makeWith(() => acquire, {
      capacity: 1,
      timeToLive: (exit) =>
        Exit.isSuccess(exit)
          ? Duration.millis(exit.value.timeToLive)
          : Duration.zero,
    });
    return {
      get: Cache.get(cache, "installation").pipe(
        Effect.map(({ token }) => token)
      ),
      invalidate: (rejected: Redacted.Redacted) =>
        Cache.invalidateWhen(
          cache,
          "installation",
          ({ token }) => Redacted.value(token) === Redacted.value(rejected)
        ).pipe(Effect.asVoid),
    };
  }).pipe(Effect.provide(shopifyAdminHttpClientLayer(fetchApi)));
