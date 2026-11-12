import { renderReport, withCommandOutput } from "@repo/cli-core/command-output";
import type { RuntimeEnvironmentPublisher } from "@repo/cli-core/runtime-environment";
import {
  runtimeEnvironmentDestinationFlags,
  runtimeEnvironmentDestinationFromFlags,
} from "@repo/cli-core/runtime-environment-cli";
import { toUserError } from "@repo/cli-core/user-error";
import {
  contentAuthoringCommands,
  contentSetupFlags,
  setupContent,
} from "@repo/cms-core/cli";
import { localization } from "@repo/site-config";
import type { Layer, Effect as EffectType } from "effect";
import {
  Config,
  ConfigProvider,
  Console,
  Effect,
  Option,
  Redacted,
} from "effect";
import { Command, Flag } from "effect/cli";

import {
  contentstackContentModel,
  prepareContentstackContent,
} from "../content/destination";
import { createContentstackProvisioningLayer } from "./layer";
import type { ContentstackMigrationLedger } from "./migrations/ledger";
import {
  getContentstackMigrationState,
  migrateContentstack,
} from "./migrations/migrate";
import type { ContentstackMigrationState } from "./migrations/model";
import { cmsProvisioningReport } from "./output";
import { ContentstackCli } from "./provisioning/contentstack-cli";
import {
  CONTENTSTACK_ENVIRONMENTS,
  ContentstackCliError,
} from "./provisioning/model";
import { reconcileContentstackPreviewUrls } from "./provisioning/preview";
import { provisionContentstack } from "./provisioning/provision";
import type { ContentstackRecipe } from "./provisioning/recipe";
import { requireSupportedContentstackCliVersion } from "./provisioning/require-cli-version";
import type { ContentstackRuntimeCredentialInput } from "./provisioning/runtime-credentials";
import { runContentstackGraphqlGeneration } from "./provisioning/runtime-credentials-live";

const asUserError = <A, E, R>(effect: EffectType.Effect<A, E, R>) =>
  effect.pipe(Effect.mapError(toUserError));

const managementTokenAliasFlag = () =>
  Flag.String("management-token-alias").pipe(
    Flag.withDescription(
      "Local csdx alias for the target stack Management Token"
    )
  );

const printPendingMigrations = (state: ContentstackMigrationState) =>
  Effect.forEach(
    state.pending,
    (migration) => Console.log(`  - ${migration.fileName}`),
    { discard: true }
  );

type ProvisioningLayer<E, R> = Layer.Layer<
  | ContentstackCli
  | ContentstackRecipe
  | ContentstackMigrationLedger
  | ContentstackRuntimeCredentialInput
  | RuntimeEnvironmentPublisher,
  Layer.Error<ReturnType<typeof createContentstackProvisioningLayer<E, R>>>,
  Layer.Services<ReturnType<typeof createContentstackProvisioningLayer<E, R>>>
>;

export const createCmsCommand = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>,
  contentstackLayer: ProvisioningLayer<
    E,
    R
  > = createContentstackProvisioningLayer(configProvider)
) => {
  const generate = Command.make("generate", {}, () =>
    asUserError(
      Effect.gen(function* () {
        const apiKey = yield* Config.NonEmptyString("CONTENTSTACK_API_KEY");
        const deliveryToken = yield* Config.Redacted(
          "CONTENTSTACK_DELIVERY_TOKEN"
        );
        const environment = yield* Config.NonEmptyString(
          "CONTENTSTACK_ENVIRONMENT"
        );
        const host = yield* Config.String(
          "CONTENTSTACK_GRAPHQL_HOST_NAME"
        ).pipe(Config.withDefault("graphql.contentstack.com"));
        yield* runContentstackGraphqlGeneration({
          apiKey,
          deliveryToken: Redacted.value(deliveryToken),
          environment,
          host,
        });
        yield* Console.log("Generated Contentstack GraphQL schema and types.");
      }).pipe(Effect.provide(ConfigProvider.layer(configProvider)))
    )
  ).pipe(
    Command.withDescription("Generate GraphQL files from the configured stack")
  );

  const provision = Command.make(
    "provision",
    {
      contentstackEnvironment: Flag.Literals(
        "contentstack-environment",
        CONTENTSTACK_ENVIRONMENTS
      ).pipe(
        Flag.withDescription("Environment used by the generated runtime file"),
        Flag.withDefault("development")
      ),
      localUrl: Flag.String("local-url").pipe(
        Flag.withDescription("Local application URL for Contentstack previews"),
        Flag.withDefault("https://web.juniper-paw-20261112.localhost")
      ),
      managementTokenAlias: managementTokenAliasFlag(),
      skipBaseline: Flag.Boolean("skip-baseline").pipe(
        Flag.withDescription(
          "Keep an existing model and entries, then apply pending migrations and regenerate GraphQL types"
        ),
        Flag.withDefault(false)
      ),
      ...runtimeEnvironmentDestinationFlags(),
      productionUrl: Flag.String("production-url").pipe(
        Flag.withDescription(
          "Storefront HTTPS origin for the selected Contentstack environment's preview URLs"
        ),
        Flag.optional
      ),
      stackMasterLocale: Flag.String("stack-master-locale").pipe(
        Flag.withDescription(
          "Target stack master locale used to map the English starter entries"
        ),
        Flag.withDefault(localization.defaultLocale.toLowerCase())
      ),
    },
    ({
      contentstackEnvironment,
      environment,
      localUrl,
      managementTokenAlias,
      output,
      overwrite,
      productionUrl,
      skipBaseline,
      stackMasterLocale,
      store,
      vercelProject,
      vercelTeam,
      yes,
    }) => {
      const provisioningOptions = {
        destination: runtimeEnvironmentDestinationFromFlags({
          environment,
          output,
          overwrite,
          store,
          vercelProject,
          vercelTeam,
          yes,
        }),
        environment: contentstackEnvironment,
        localUrl,
        managementTokenAlias,
        productionUrl: Option.getOrUndefined(productionUrl),
        skipBaseline,
        stackMasterLocale,
      };

      return withCommandOutput(
        {
          title: "Provision CMS",
          context: `Contentstack · ${contentstackEnvironment}`,
          failureNote:
            "Earlier stack changes may remain. Inspect the failed phase and provider error before retrying.",
        },
        (style) =>
          asUserError(provisionContentstack(provisioningOptions)).pipe(
            Effect.flatMap((receipt) =>
              Console.log(
                renderReport(
                  cmsProvisioningReport(receipt, provisioningOptions),
                  style
                )
              )
            )
          )
      );
    }
  ).pipe(
    Command.withDescription(
      "Import the starter content model and write runtime credentials"
    ),
    Command.provide(contentstackLayer)
  );

  const preview = Command.make(
    "preview",
    {
      environment: Flag.String("contentstack-environment"),
      frontendOrigin: Flag.String("frontend-origin"),
      managementTokenAlias: managementTokenAliasFlag(),
    },
    ({ environment, frontendOrigin, managementTokenAlias }) =>
      asUserError(
        Effect.gen(function* () {
          const cli = yield* ContentstackCli;
          yield* requireSupportedContentstackCliVersion();
          const stack = yield* cli.resolveStack(managementTokenAlias);
          const { region } = yield* cli.runtimeEndpoints();
          const urls = yield* reconcileContentstackPreviewUrls({
            stack,
            region,
            environment,
            frontendOrigin,
          });
          yield* Console.log(
            `Contentstack preview URLs verified for ${stack.apiKey} / ${environment}`
          );
          yield* Effect.forEach(
            urls,
            ({ locale, url }) => Console.log(`  ${locale}  ${url}`),
            { discard: true }
          );
          yield* Console.log(
            "In the stack's Visual Experience settings, enable Live Preview and select this environment. Open a published entry to verify Live Preview and Visual Editor."
          );
        })
      )
  ).pipe(
    Command.withDescription(
      "Set the storefront preview URLs for a Contentstack environment"
    ),
    Command.provide(contentstackLayer)
  );

  const migrate = Command.make(
    "migrate",
    {
      dryRun: Flag.Boolean("dry-run").pipe(
        Flag.withDescription("Show pending migrations without applying them"),
        Flag.withDefault(false)
      ),
      managementTokenAlias: managementTokenAliasFlag(),
    },
    ({ dryRun, managementTokenAlias }) =>
      dryRun
        ? asUserError(getContentstackMigrationState(managementTokenAlias)).pipe(
            Effect.flatMap((state) =>
              state.pending.length === 0
                ? Console.log("✓ No pending Contentstack migrations")
                : Console.log(
                    `${state.pending.length} pending Contentstack migration(s):`
                  ).pipe(
                    Effect.andThen(printPendingMigrations(state)),
                    Effect.andThen(
                      Console.log("[DRY RUN] No migrations were applied")
                    )
                  )
            )
          )
        : asUserError(migrateContentstack(managementTokenAlias)).pipe(
            Effect.flatMap((receipt) =>
              receipt.applied.length === 0
                ? Console.log("✓ No pending Contentstack migrations")
                : Console.log(
                    `✓ Applied ${receipt.applied.length} Contentstack migration(s)`
                  )
            )
          )
  ).pipe(
    Command.withDescription("Apply pending Contentstack schema migrations")
  );

  const plan = Command.make(
    "plan",
    { managementTokenAlias: managementTokenAliasFlag() },
    ({ managementTokenAlias }) =>
      asUserError(getContentstackMigrationState(managementTokenAlias)).pipe(
        Effect.flatMap((state) =>
          state.pending.length === 0
            ? Console.log("✓ No pending Contentstack migrations")
            : Console.log(
                `Would apply ${state.pending.length} Contentstack migration(s):`
              ).pipe(Effect.andThen(printPendingMigrations(state)))
        )
      )
  ).pipe(Command.withDescription("Show pending Contentstack migrations"));

  const status = Command.make(
    "status",
    { managementTokenAlias: managementTokenAliasFlag() },
    ({ managementTokenAlias }) =>
      asUserError(getContentstackMigrationState(managementTokenAlias)).pipe(
        Effect.flatMap((state) =>
          Console.log("Contentstack migration status:").pipe(
            Effect.andThen(Console.log(`  Total: ${state.migrations.length}`)),
            Effect.andThen(Console.log(`  Applied: ${state.applied.length}`)),
            Effect.andThen(Console.log(`  Pending: ${state.pending.length}`)),
            Effect.andThen(
              state.pending.length === 0
                ? Effect.void
                : Console.log("Pending migrations:").pipe(
                    Effect.andThen(printPendingMigrations(state))
                  )
            )
          )
        )
      )
  ).pipe(Command.withDescription("Show Contentstack migration status"));

  const migrateWithSubcommands = migrate.pipe(
    Command.withSubcommands([plan, status]),
    Command.provide(contentstackLayer)
  );

  return Command.make("cms", {}, () => Effect.void).pipe(
    Command.withDescription("Contentstack CMS administration commands"),
    Command.withSubcommands([
      migrateWithSubcommands,
      provision,
      generate,
      preview,
      Command.make("data").pipe(
        Command.withSubcommands([
          ...contentAuthoringCommands(contentstackContentModel),
          Command.make(
            "setup",
            {
              ...contentSetupFlags,
              managementTokenAlias: managementTokenAliasFlag().pipe(
                Flag.optional
              ),
              branch: Flag.String("branch").pipe(Flag.withDefault("main")),
              contentstackEnvironment: Flag.String(
                "contentstack-environment"
              ).pipe(Flag.withDefault("development")),
            },
            (options) =>
              setupContent(
                options,
                contentstackContentModel(),
                (directory) =>
                  Option.match(options.managementTokenAlias, {
                    onNone: () =>
                      Effect.fail(
                        new ContentstackCliError({
                          cause: undefined,
                          message:
                            "Pass --management-token-alias for the target stack to import content.",
                          operation: "resolveAlias",
                        })
                      ),
                    onSome: (alias) =>
                      prepareContentstackContent({
                        alias,
                        branch: options.branch,
                        environment: options.contentstackEnvironment,
                        directory,
                      }).pipe(Effect.provide(contentstackLayer)),
                  }),
                configProvider
              )
          ),
        ])
      ),
    ])
  );
};
