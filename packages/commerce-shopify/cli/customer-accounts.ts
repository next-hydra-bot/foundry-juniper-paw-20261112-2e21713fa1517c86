import { randomBytes } from "node:crypto";

import {
  phase,
  renderReport,
  withCommandOutput,
} from "@repo/cli-core/command-output";
import {
  RuntimeEnvironmentPublisher,
  runtimeEnvironmentManifestFromSchema,
  runtimeEnvironmentPublisherLayer,
} from "@repo/cli-core/runtime-environment";
import type { RuntimeEnvironmentValues } from "@repo/cli-core/runtime-environment";
import {
  runtimeEnvironmentDestinationFlags,
  runtimeEnvironmentDestinationFromFlags,
} from "@repo/cli-core/runtime-environment-cli";
import {
  Config,
  ConfigProvider,
  Console,
  Effect,
  Option,
  Redacted,
  Schema,
} from "effect";
import type { Effect as EffectType } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { DestinationError } from "migrate-sdk";

import { prepareAdminSettings } from "../admin/provisioning";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The provider CLI composes its Admin client.
import { makeCatalogAdmin } from "../catalog/admin";
import { shopifyCustomerAccountsReport } from "./output";

const fail = (message: string) => new DestinationError({ message });
export const customerAccountOrigin = (value: string) =>
  Effect.try({
    catch: () =>
      fail(
        "Provide an HTTPS storefront origin without a path, query, credentials or fragment. Use HTTPS with Portless or a tunnel accepted by Shopify."
      ),
    try: () => {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        throw new Error("Invalid origin");
      }
      return url.origin;
    },
  });

export const configureCustomerAccounts = Effect.fn(
  "Shopify.configureCustomerAccounts"
)(function* (options: {
  readonly clientId: string;
  readonly config: ConfigProvider.ConfigProvider;
  readonly destination: Parameters<
    RuntimeEnvironmentPublisher["Service"]["prepare"]
  >[0]["destination"];
  readonly origin: string;
}) {
  const origin = yield* customerAccountOrigin(options.origin);
  const clientId = yield* Schema.decodeEffect(Schema.NonEmptyString)(
    options.clientId
  ).pipe(
    Effect.mapError(() =>
      fail(
        "Provide the public Headless Customer Account client ID from Shopify; it is separate from the Admin app client ID."
      )
    )
  );
  const settings = yield* Config.all({
    accessToken: Config.option(Config.Redacted("SHOPIFY_ADMIN_ACCESS_TOKEN")),
    clientId: Config.option(Config.String("SHOPIFY_ADMIN_CLIENT_ID")),
    clientSecret: Config.option(Config.Redacted("SHOPIFY_ADMIN_CLIENT_SECRET")),
    domain: Config.String("SHOPIFY_STORE_DOMAIN"),
    sessionSecret: Config.option(
      Config.Redacted("SHOPIFY_CUSTOMER_SESSION_SECRET")
    ),
    shopId: Config.option(Config.String("SHOPIFY_SHOP_ID")),
  }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, options.config));
  const suppliedToken = Option.getOrUndefined(settings.accessToken);
  const suppliedSession = Option.getOrUndefined(settings.sessionSecret);
  if (
    suppliedSession !== undefined &&
    Redacted.value(suppliedSession).length < 32
  ) {
    return yield* fail(
      "SHOPIFY_CUSTOMER_SESSION_SECRET must contain at least 32 characters."
    );
  }
  const credentialFields: Readonly<Record<string, Schema.Top>> =
    suppliedToken === undefined
      ? {
          SHOPIFY_ADMIN_CLIENT_ID: Schema.NonEmptyString,
          SHOPIFY_ADMIN_CLIENT_SECRET: Schema.Redacted(Schema.NonEmptyString),
        }
      : { SHOPIFY_ADMIN_ACCESS_TOKEN: Schema.Redacted(Schema.NonEmptyString) };
  const manifest = runtimeEnvironmentManifestFromSchema(
    {
      ...credentialFields,
      SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: Schema.NonEmptyString,
      SHOPIFY_CUSTOMER_SESSION_SECRET: Schema.Redacted(Schema.NonEmptyString),
      SHOPIFY_SHOP_ID: Schema.NonEmptyString,
      SHOPIFY_STOREFRONT_ORIGIN: Schema.NonEmptyString,
      SHOPIFY_STORE_DOMAIN: Schema.NonEmptyString,
    },
    ["web"]
  );
  const publisher = yield* RuntimeEnvironmentPublisher;
  const prepared = yield* publisher.prepare({
    destination: options.destination,
    manifest,
  });
  const adminSettings = yield* prepareAdminSettings(options.config);
  const admin = makeCatalogAdmin(adminSettings);
  const response = yield* admin.request(
    "customerAccountShop",
    "query CustomerAccountShop { shop { id } }"
  );
  const data = yield* Schema.decodeUnknownEffect(
    Schema.Struct({ shop: Schema.Struct({ id: Schema.String }) })
  )(response).pipe(
    Effect.mapError(() => fail("Shopify did not return this store's identity."))
  );
  const shopId = /^gid:\/\/shopify\/Shop\/(?<id>\d+)$/u.exec(data.shop.id)
    ?.groups?.id;
  if (
    shopId === undefined ||
    (Option.isSome(settings.shopId) && settings.shopId.value !== shopId)
  ) {
    return yield* fail(
      "SHOPIFY_SHOP_ID does not match the configured Admin store."
    );
  }
  const credentialValues: RuntimeEnvironmentValues =
    suppliedToken === undefined
      ? {
          SHOPIFY_ADMIN_CLIENT_ID:
            Option.getOrUndefined(settings.clientId) ?? "",
          SHOPIFY_ADMIN_CLIENT_SECRET:
            Option.getOrUndefined(settings.clientSecret) ?? Redacted.make(""),
        }
      : { SHOPIFY_ADMIN_ACCESS_TOKEN: suppliedToken };
  const receipt = yield* publisher.publish(prepared, {
    ...credentialValues,
    SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: clientId,
    SHOPIFY_CUSTOMER_SESSION_SECRET:
      suppliedSession ?? Redacted.make(randomBytes(32).toString("base64url")),
    SHOPIFY_SHOP_ID: shopId,
    SHOPIFY_STOREFRONT_ORIGIN: origin,
    SHOPIFY_STORE_DOMAIN: settings.domain,
  });
  return {
    callback: `${origin}/account/authorize`,
    logoutCallback: `${origin}/account/logout/complete`,
    signOutContinuation: `${origin}/account/logout/continue`,
    origin,
    receipt,
    shopId,
  };
});

export const createCustomerAccountsCommand = <E, R>(
  provider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  Command.make(
    "customer-accounts",
    {
      ...runtimeEnvironmentDestinationFlags(),
      clientId: Flag.String("client-id").pipe(
        Flag.withDescription(
          "Shopify Headless public Customer Account client ID"
        )
      ),
      origin: Flag.String("origin").pipe(
        Flag.withDescription(
          "Exact HTTPS storefront origin used for the OAuth callback"
        )
      ),
      output: Flag.String("output").pipe(
        Flag.withDefault("shopify-customer-accounts.env")
      ),
    },
    ({ clientId, origin, ...destinationFlags }) =>
      withCommandOutput(
        {
          title: "Configure Shopify Customer Accounts",
          context: origin,
          failureNote:
            "The credential destination may already contain values. Check the selected origin and publication settings before retrying.",
        },
        (style) =>
          Effect.gen(function* () {
            const result = yield* phase(
              {
                group: "Customer accounts",
                title: "Publish the storefront configuration",
                interactive: true,
              },
              configureCustomerAccounts({
                clientId,
                config: yield* provider,
                destination:
                  runtimeEnvironmentDestinationFromFlags(destinationFlags),
                origin,
              })
            );
            yield* Console.log(
              renderReport(shopifyCustomerAccountsReport(result), style)
            );
          }).pipe(
            Effect.mapError(
              (error) =>
                new CliError.UserError({
                  cause: undefined,
                  userMessage: Schema.is(DestinationError)(error)
                    ? error.message
                    : "Customer Account configuration failed. Check credentials, output settings and the selected store.",
                })
            )
          )
      )
  ).pipe(Command.provide(runtimeEnvironmentPublisherLayer));
