import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { CmsCommerceMigrations } from "@repo/cms-core/commerce";
import {
  loadProvisioningCatalog,
  prepareDataRegistry,
} from "@repo/commerce-core/provisioning/pipeline";
import { Effect, Layer } from "effect";
import { DestinationError } from "migrate-sdk";

import { prepareB2CProfile } from "./profile";

export const cmsCommerceMigrationsLayer = Layer.succeed(CmsCommerceMigrations, {
  prepare: (config, directory, stateDirectory, bindingsFile) =>
    Effect.gen(function* () {
      const source = yield* loadProvisioningCatalog(directory);
      const conventional = resolve(directory, "bindings.json");
      const result = yield* prepareDataRegistry(config, prepareB2CProfile, {
        bindingsFile:
          bindingsFile ?? (existsSync(conventional) ? conventional : undefined),
        directory,
        stateDirectory,
      });
      const definitions = result.registry.definitions();
      const categories = definitions.find(
        (definition) =>
          definition.id === `${source.files.catalogName}-categories`
      );
      if (!categories) {
        return yield* new DestinationError({
          message: "The commerce profile has no category migration.",
        });
      }
      return {
        categories,
        definitions,
        store: result.store,
        target: result.target,
      };
    }).pipe(
      Effect.mapError(
        (cause) => new DestinationError({ message: cause.message })
      )
    ),
  source: (directory) =>
    loadProvisioningCatalog(directory).pipe(
      Effect.map((catalog) => ({
        categoryKeys: catalog.catalogs[
          catalog.files.catalogName
        ]!.categories.map((category) => category.key),
        categoryMigrationId: `${catalog.files.catalogName}-categories`,
      })),
      Effect.mapError(
        (cause) => new DestinationError({ message: cause.message })
      )
    ),
});
