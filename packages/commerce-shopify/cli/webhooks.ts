import { withCommandOutput } from "@repo/cli-core/command-output";
import {
  RuntimeEnvironmentPublisher,
  runtimeEnvironmentManifestFromSchema,
  runtimeEnvironmentPublisherLayer,
} from "@repo/cli-core/runtime-environment";
import {
  runtimeEnvironmentDestinationFlags,
  runtimeEnvironmentDestinationFromFlags,
} from "@repo/cli-core/runtime-environment-cli";
import { Config, ConfigProvider, Console, Effect, Schema } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import { DestinationError } from "migrate-sdk";

import { prepareAdminSettings } from "../admin/provisioning";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The provider CLI composes its Admin client.
import { makeCatalogAdmin } from "../catalog/admin";
import type { CatalogAdmin } from "../catalog/admin";
import { catalogWebhookTopics } from "../product/event";
import { customerAccountOrigin } from "./customer-accounts";

const Page = Schema.Struct({
  webhookSubscriptions: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        filter: Schema.NullOr(Schema.String),
        format: Schema.String,
        id: Schema.String,
        includeFields: Schema.Array(Schema.String),
        topic: Schema.String,
        uri: Schema.String,
      })
    ),
    pageInfo: Schema.Struct({
      endCursor: Schema.NullOr(Schema.String),
      hasNextPage: Schema.Boolean,
    }),
  }),
});

/** Reuses exact topic/destination subscriptions; never modifies another destination. */
export const provisionCatalogWebhooks = Effect.fn(
  "Shopify.provisionCatalogWebhooks"
)(function* (
  admin: CatalogAdmin,
  options: { readonly origin: string; readonly dryRun: boolean }
) {
  const origin = yield* customerAccountOrigin(options.origin);
  const uri = `${origin}/api/commerce/catalog-events`;
  const existing = new Map<
    string,
    (typeof Page.Type)["webhookSubscriptions"]["nodes"][number]
  >();
  const cursors = new Set<string>();
  let after: string | null = null;
  while (true) {
    const data: Record<string, Schema.Json> = yield* admin.request(
      "catalogWebhooks",
      `query CatalogWebhooks($after:String) {
      webhookSubscriptions(first:100, after:$after) { nodes { id topic uri filter format includeFields } pageInfo { endCursor hasNextPage } }
    }`,
      { after }
    );
    const decoded: typeof Page.Type = yield* Schema.decodeUnknownEffect(Page)(
      data
    ).pipe(
      Effect.mapError(
        () =>
          new DestinationError({
            message: "Shopify returned an invalid webhook subscription page",
          })
      )
    );
    const page = decoded.webhookSubscriptions;
    for (const subscription of page.nodes) {
      if (subscription.uri === uri) {
        existing.set(subscription.topic, subscription);
      }
    }
    if (!page.pageInfo.hasNextPage) {
      break;
    }
    const cursor = page.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor)) {
      return yield* new DestinationError({
        message: "Shopify returned an invalid webhook cursor",
      });
    }
    cursors.add(cursor);
    after = cursor;
  }
  const changes = [];
  for (const topic of Object.keys(catalogWebhookTopics)) {
    const subscription = existing.get(topic);
    const configured =
      subscription !== undefined &&
      !subscription.filter &&
      subscription.format === "JSON" &&
      subscription.includeFields.length === 0;
    let action = "unchanged";
    if (!configured) {
      if (subscription) {
        action = options.dryRun ? "would-update" : "updated";
      } else {
        action = options.dryRun ? "would-create" : "created";
      }
    }
    if (action === "created") {
      yield* admin.mutation(
        "webhookSubscriptionCreate",
        `mutation CatalogWebhook($topic:WebhookSubscriptionTopic!, $subscription:WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic:$topic, webhookSubscription:$subscription) { webhookSubscription { id } userErrors { message } }
      }`,
        { subscription: { format: "JSON", uri }, topic }
      );
    } else if (action === "updated" && subscription) {
      yield* admin.mutation(
        "webhookSubscriptionUpdate",
        `mutation CatalogWebhookUpdate($id:ID!, $subscription:WebhookSubscriptionInput!) {
        webhookSubscriptionUpdate(id:$id, webhookSubscription:$subscription) { webhookSubscription { id } userErrors { message } }
      }`,
        {
          id: subscription.id,
          subscription: {
            filter: null,
            format: "JSON",
            includeFields: null,
            uri,
          },
        }
      );
    }
    changes.push({ action, topic });
  }
  return { changes, uri };
});

export const createWebhooksCommand = <E, R>(
  provider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  Command.make("webhooks", {}, () => Effect.void).pipe(
    Command.withSubcommands([
      Command.make(
        "provision",
        {
          ...runtimeEnvironmentDestinationFlags(),
          dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
          origin: Flag.String("origin").pipe(
            Flag.withDescription(
              "Public HTTPS storefront origin receiving catalog events"
            )
          ),
          output: Flag.String("output").pipe(
            Flag.withDefault("shopify-catalog-webhooks.env")
          ),
        },
        ({ origin, dryRun, ...destinationFlags }) =>
          withCommandOutput(
            {
              context: origin,
              failureNote:
                "Some subscriptions may already exist. Retry with the same origin and output destination.",
              title: "Configure Shopify catalog webhooks",
            },
            () =>
              Effect.gen(function* () {
                const config = yield* provider;
                const originValue = yield* customerAccountOrigin(origin);
                const settings = yield* Config.all({
                  domain: Config.String("SHOPIFY_STORE_DOMAIN"),
                  secret: Config.Redacted("SHOPIFY_ADMIN_CLIENT_SECRET"),
                }).pipe(
                  Effect.provideService(ConfigProvider.ConfigProvider, config)
                );
                const publisher = yield* RuntimeEnvironmentPublisher;
                const prepared = dryRun
                  ? undefined
                  : yield* publisher.prepare({
                      destination:
                        runtimeEnvironmentDestinationFromFlags(
                          destinationFlags
                        ),
                      manifest: runtimeEnvironmentManifestFromSchema(
                        {
                          SHOPIFY_CATALOG_WEBHOOK_SECRET: Schema.Redacted(
                            Schema.NonEmptyString
                          ),
                          SHOPIFY_STORE_DOMAIN: Schema.NonEmptyString,
                        },
                        ["web"]
                      ),
                    });
                const adminSettings = yield* prepareAdminSettings(config);
                const result = yield* provisionCatalogWebhooks(
                  makeCatalogAdmin(adminSettings),
                  { dryRun, origin: originValue }
                );
                if (prepared) {
                  yield* publisher.publish(prepared, {
                    SHOPIFY_CATALOG_WEBHOOK_SECRET: settings.secret,
                    SHOPIFY_STORE_DOMAIN: settings.domain,
                  });
                }
                yield* Console.log(`Catalog events: ${result.uri}`);
                for (const change of result.changes) {
                  yield* Console.log(`${change.action}: ${change.topic}`);
                }
              }).pipe(
                Effect.mapError(
                  (cause) =>
                    new CliError.UserError({
                      cause: undefined,
                      userMessage: Schema.is(DestinationError)(cause)
                        ? cause.message
                        : "Webhook provisioning failed. Check Admin credentials, app scopes and output settings.",
                    })
                )
              )
          )
      ),
    ]),
    Command.provide(runtimeEnvironmentPublisherLayer)
  );
