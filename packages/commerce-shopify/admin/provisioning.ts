import { Config, ConfigProvider, Effect, Option, Redacted } from "effect";
import { DestinationError } from "migrate-sdk";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The provider's provisioning composition root owns this token client.
import { makeShopifyAdminAccessToken } from "./access-token-core";

/** Prepare one command's cache without loading secrets or contacting Shopify. */
export const prepareAdminSettings = (
  provider: ConfigProvider.ConfigProvider,
  fetchApi: typeof fetch = globalThis.fetch
) =>
  Effect.gen(function* () {
    const credentials = yield* Effect.cached(
      Effect.gen(function* () {
        const config = yield* Config.all({
          clientId: Config.option(Config.String("SHOPIFY_ADMIN_CLIENT_ID")),
          clientSecret: Config.option(
            Config.Redacted("SHOPIFY_ADMIN_CLIENT_SECRET")
          ),
          domain: Config.String("SHOPIFY_STORE_DOMAIN"),
          token: Config.option(Config.Redacted("SHOPIFY_ADMIN_ACCESS_TOKEN")),
        }).pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, provider),
          Effect.mapError(
            () =>
              new DestinationError({
                message:
                  "Configure SHOPIFY_STORE_DOMAIN and Shopify Admin client credentials.",
              })
          )
        );
        const token = Option.getOrUndefined(config.token);
        const clientSecret = Option.getOrUndefined(config.clientSecret);
        const source = yield* makeShopifyAdminAccessToken(
          {
            SHOPIFY_ADMIN_ACCESS_TOKEN:
              token === undefined ? undefined : Redacted.value(token),
            // Setup also uses the app ID as destination identity in supplied-token mode.
            SHOPIFY_ADMIN_CLIENT_ID:
              token === undefined
                ? Option.getOrUndefined(config.clientId)
                : undefined,
            SHOPIFY_ADMIN_CLIENT_SECRET:
              token !== undefined || clientSecret === undefined
                ? undefined
                : Redacted.value(clientSecret),
            SHOPIFY_STORE_DOMAIN: config.domain,
          },
          fetchApi
        );
        return { domain: config.domain, source };
      })
    );
    return Effect.gen(function* () {
      const { domain, source } = yield* credentials;
      const token = yield* source.get;
      return { domain, token: Redacted.value(token) };
    }).pipe(
      Effect.mapError(
        (error) => new DestinationError({ message: error.message })
      )
    );
  });
