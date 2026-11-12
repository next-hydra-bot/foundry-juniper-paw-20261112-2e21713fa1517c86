import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

import { loadCompanyCatalogSetup } from "@repo/commerce-core/catalog/files";
import type { CatalogMigrationOptions } from "@repo/commerce-core/catalog/files";
import { readShippingSetup } from "@repo/commerce-core/provisioning/shipping";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinitionRegistry,
  toMigrationDefinitionGroupId,
} from "migrate-sdk";
import { defineMigrationCliConfig } from "migrate-sdk/cli";
import { FileMigrationStore } from "migrate-sdk/stores/file";

import { prepareAdminSettings } from "../admin/provisioning";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- CLI registry assembly.
import { makeCatalogAdmin } from "./admin";
import {
  CompanyCatalogBindings,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Provider-owned migration composition root.
  makeCompanyCatalogDestination,
  validateCompanyCatalogBindings,
} from "./b2b";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- CLI registry assembly.
import { makeCompanyCatalogMigrations } from "./company-migrations";
import type { DeliveryProfileInput } from "./delivery-profile-migration";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This Migrate configuration is the import tool composition root.
import { makeCatalogDestination, settingsFromEnvironment } from "./destination";
import { shopifyCatalogReaders } from "./mapping";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Registry assembly belongs in this Migrate configuration, not a storefront runtime.
import { makeCatalogRegistry } from "./migrations";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- CLI registry assembly.
import { makeShippingMigrations } from "./shipping-migrations";

export const defineCatalogMigrationConfig = async (
  options: CatalogMigrationOptions & {
    readonly shipping?: {
      readonly file: string | URL;
      readonly profile: DeliveryProfileInput;
    };
  }
) => {
  const environmentFile = new URL(".env", import.meta.url);
  if (!options.environment && existsSync(environmentFile)) {
    loadEnvFile(fileURLToPath(environmentFile));
  }
  const environment = options.environment ?? process.env;
  const catalogSettings = await Effect.runPromise(
    settingsFromEnvironment(environment)
  );
  const target = createHash("sha256")
    .update(JSON.stringify(environment.SHOPIFY_STORE_DOMAIN ?? ""))
    .digest("hex");
  const catalogMigrationStore = FileMigrationStore.layer({
    directory: path.join(
      options.stateDirectory instanceof URL
        ? fileURLToPath(options.stateDirectory)
        : options.stateDirectory,
      target
    ),
  });
  const readers = shopifyCatalogReaders(options.catalogs);
  const registry = makeCatalogRegistry({
    readers,
    publicationId: environment.SHOPIFY_CATALOG_PUBLICATION_ID,
    locationId: environment.SHOPIFY_CATALOG_LOCATION_ID,
    destination: makeCatalogDestination({ readers, settings: catalogSettings }),
    store: catalogMigrationStore,
  });
  const { shipping } = options;
  const shippingDefinitions =
    shipping === undefined
      ? []
      : await Effect.runPromise(
          Effect.gen(function* () {
            const read = readShippingSetup(shipping.file);
            yield* read;
            const settings = yield* prepareAdminSettings(
              ConfigProvider.fromUnknown(environment)
            );
            return yield* makeShippingMigrations({
              admin: makeCatalogAdmin(settings),
              profile: shipping.profile,
              read,
              store: catalogMigrationStore,
            });
          })
        );
  const baseDefinitions = [...registry.definitions(), ...shippingDefinitions];
  const { company } = options;
  if (!company) {
    return defineMigrationCliConfig({
      registry: MigrationDefinitionRegistry.make({
        definitions: baseDefinitions,
      }),
    });
  }

  const readSetup = Effect.try({
    try: () => loadCompanyCatalogSetup(company, options.catalogs),
    catch: (cause) =>
      new DestinationError({
        cause,
        message: "Unable to read the company catalog source",
      }),
  });
  const setup = Effect.runSync(readSetup);
  const bindings = Schema.decodeUnknownSync(
    Schema.fromJsonString(CompanyCatalogBindings)
  )(readFileSync(company.bindingsFile, "utf-8"), { onExcessProperty: "error" });
  validateCompanyCatalogBindings(bindings, setup.plans);
  const companyGroup = toMigrationDefinitionGroupId("b2b-companies");
  const products = baseDefinitions.find(
    ({ id }) => id === `${setup.selling.sourceCatalog}-products`
  );
  if (!products) {
    throw new Error("Missing Shopify source Product definition");
  }
  const companyDefinitions = makeCompanyCatalogMigrations({
    destination: makeCompanyCatalogDestination(
      catalogSettings,
      bindings,
      setup.selling.sourceCatalog,
      setup.selling.key
    ),
    group: companyGroup,
    readPlans: readSetup.pipe(Effect.map(({ plans }) => plans)),
    policies: bindings.pricingGroups,
    products,
    resolveBinding: (key) => {
      const binding = bindings.companies.find(
        ({ businessUnitKey }) => businessUnitKey === key
      );
      return binding
        ? Effect.succeed(binding)
        : Effect.fail(
            new DestinationError({
              message: `Missing Shopify Company binding for ${key}`,
            })
          );
    },
    locationInput: (key) =>
      bindings.companies.find(
        ({ businessUnitKey }) => businessUnitKey === key
      ) ?? null,
    sellingKey: setup.selling.key,
    store: catalogMigrationStore,
  });
  return defineMigrationCliConfig({
    registry: MigrationDefinitionRegistry.make({
      definitions: [...baseDefinitions, ...companyDefinitions],
    }),
  });
};
