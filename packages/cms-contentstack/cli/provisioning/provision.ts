import { phase } from "@repo/cli-core/command-output";
import { RuntimeEnvironmentPublisher } from "@repo/cli-core/runtime-environment";
import type { RuntimeEnvironmentDestination } from "@repo/cli-core/runtime-environment";
import { localization } from "@repo/site-config";
import { Effect } from "effect";

import { applyContentstackMigrations } from "../migrations/migrate";
import { cmsSteps } from "../output";
import { ContentstackCli } from "./contentstack-cli";
import { ContentstackProvisioningReceipt } from "./model";
import type { ContentstackEnvironment } from "./model";
import { reconcileContentstackPreviewUrls } from "./preview";
import { ContentstackRecipe } from "./recipe";
import { requireSupportedContentstackCliVersion } from "./require-cli-version";
import {
  ContentstackRuntimeCredentialInput,
  contentstackRuntimeEnvironment,
  contentstackRuntimeEnvironmentManifest,
} from "./runtime-credentials";

export interface ProvisionContentstackOptions {
  readonly environment: ContentstackEnvironment;
  readonly localUrl: string;
  readonly managementTokenAlias: string;
  readonly destination: RuntimeEnvironmentDestination;
  readonly productionUrl?: string;
  readonly stackMasterLocale: string;
  readonly skipBaseline?: boolean;
}

export const provisionContentstack = Effect.fn(
  "ContentstackProvisioning.provision"
)(function* (options: ProvisionContentstackOptions) {
  const cli = yield* ContentstackCli;
  const recipe = yield* ContentstackRecipe;
  const credentialInput = yield* ContentstackRuntimeCredentialInput;
  const publisher = yield* RuntimeEnvironmentPublisher;

  const preparedDestination = yield* phase(
    cmsSteps.destination,
    publisher.prepare({
      destination: options.destination,
      manifest: contentstackRuntimeEnvironmentManifest,
    })
  );

  const { endpoints, stack } = yield* phase(
    cmsSteps.access,
    Effect.gen(function* () {
      yield* requireSupportedContentstackCliVersion();
      const stack = yield* cli.resolveStack(options.managementTokenAlias);
      const endpoints = yield* cli.runtimeEndpoints();
      return { endpoints, stack };
    })
  );
  const recipeReceipt = yield* phase(
    options.skipBaseline
      ? { ...cmsSteps.content, title: "Read the installed recipe metadata" }
      : cmsSteps.content,
    Effect.scoped(
      Effect.gen(function* () {
        const materialized = yield* recipe.materialize({
          locales: localization.locales,
          localUrl: options.localUrl,
          productionUrl: options.productionUrl ?? options.localUrl,
          targetMasterLocale: options.stackMasterLocale,
        });
        if (!options.skipBaseline) {
          yield* cli.importRecipe({
            directory: materialized.directory,
            managementTokenAlias: options.managementTokenAlias,
          });
        }
        return materialized;
      })
    )
  );
  const migrationReceipt = yield* phase(
    cmsSteps.migrations,
    applyContentstackMigrations({
      region: endpoints.region,
      stack,
    })
  );

  const storefront = options.productionUrl
    ? URL.parse(options.productionUrl)
    : null;
  const previewUrlsConfigured =
    storefront?.protocol === "https:" &&
    storefront.href === `${storefront.origin}/` &&
    storefront.origin !== URL.parse(options.localUrl)?.origin;
  if (previewUrlsConfigured) {
    yield* phase(
      cmsSteps.previewUrls,
      reconcileContentstackPreviewUrls({
        stack,
        region: endpoints.region,
        environment: options.environment,
        frontendOrigin: storefront.origin,
      })
    );
  }

  const credentials = yield* phase(
    cmsSteps.credentials,
    credentialInput.acquire(stack.apiKey, options.environment, endpoints)
  );
  yield* phase(cmsSteps.verify, credentialInput.verify(credentials));
  const publishedCredentials = yield* phase(
    cmsSteps.publication,
    publisher.publish(
      preparedDestination,
      contentstackRuntimeEnvironment(credentials)
    )
  );

  return new ContentstackProvisioningReceipt({
    apiKey: stack.apiKey,
    credentials: publishedCredentials,
    environments: options.skipBaseline
      ? [options.environment]
      : [...recipeReceipt.environments],
    imported: !options.skipBaseline,
    livePreviewConfigurationRequired: true,
    previewUrlsConfigured,
    migrationsApplied: migrationReceipt.applied.length,
    recipeVersion: recipeReceipt.version,
    region: endpoints.region,
  });
});
