import {
  phase,
  renderReport,
  withCommandOutput,
} from "@repo/cli-core/command-output";
import { ConfigProvider, Console, Effect, Layer, Option } from "effect";
import type { Effect as EffectType } from "effect";
import { CliError, Command, Flag } from "effect/cli";

import { createCustomerAccountsCommand } from "./customer-accounts";
import { createDataCommand } from "./data";
import { ShopifyMarkets } from "./markets";
import { shopifyMarketsReport } from "./output";
import { createRedirectThemeCommand } from "./redirect-theme";
import { createWebhooksCommand } from "./webhooks";

export {
  commerceSearchIndexingSource,
  withCompanySearchIndexing,
} from "./search-indexing";

/** The selected commerce provider contributes this command to the workspace CLI. */
export const createCommerceCommand = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const provision = Command.make(
    "provision",
    {
      dryRun: Flag.Boolean("dry-run").pipe(
        Flag.withDescription("Read current Markets without applying changes"),
        Flag.withDefault(false)
      ),
      stores: Flag.String("stores").pipe(
        Flag.optional,
        Flag.withDescription(
          "Comma-separated Store keys; provisions their declared Markets (defaults to all Stores)"
        )
      ),
    },
    ({ stores, dryRun }) =>
      withCommandOutput(
        {
          context: "Shopify",
          failureNote:
            "Some settings may already be configured. Review the plan before retrying.",
          title: "Configure Shopify project",
        },
        (style) =>
          Effect.gen(function* () {
            const markets = yield* ShopifyMarkets;
            const requested = stores.pipe(
              Option.map((value) => value.split(",").map((key) => key.trim()))
            );
            const changes = yield* phase(
              {
                group: "Markets",
                title: dryRun
                  ? "Read the Market plan"
                  : "Apply Market configuration",
              },
              markets.provision({
                dryRun,
                storeKeys: Option.getOrUndefined(requested),
              })
            );
            yield* Console.log(
              renderReport(shopifyMarketsReport(changes, dryRun), style)
            );
          }).pipe(
            Effect.mapError(
              (cause) =>
                new CliError.UserError({
                  cause,
                  userMessage: cause.message,
                })
            )
          )
      )
  ).pipe(
    Command.provide(
      ShopifyMarkets.layer.pipe(
        Layer.provide(ConfigProvider.layer(configProvider))
      )
    )
  );

  return Command.make("commerce", {}, () => Effect.void).pipe(
    Command.withDescription("Shopify administration commands"),
    Command.withSubcommands([
      createDataCommand(configProvider),
      createRedirectThemeCommand(),
      createCustomerAccountsCommand(configProvider),
      createWebhooksCommand(configProvider),
      Command.make("project", {}, () => Effect.void).pipe(
        Command.withDescription("Configure an existing Shopify store"),
        Command.withSubcommands([provision])
      ),
    ])
  );
};
