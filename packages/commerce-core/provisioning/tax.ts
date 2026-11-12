import { documentRows, readSourceFile } from "@repo/cli-core/json-migrations";
import { Effect, Path, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationReferenceLookup,
  SourceIdentity,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  Tracking,
} from "migrate-sdk";

import { CatalogTaxSetup, validateCatalogTaxSetup } from "../catalog/tax";
import { loadProvisioningCatalog, readProfileDocument } from "./pipeline";
import type { ProfilePreparation, ProvisioningStore } from "./pipeline";

export const loadTaxSetup = (options: ProfilePreparation) =>
  Effect.gen(function* () {
    if (!options.taxesFile && !options.taxConfigFile) {
      return undefined;
    }
    if (!options.taxesFile || !options.taxConfigFile) {
      return yield* new DestinationError({
        message:
          "Supply both --taxes (shared classifications and assignments) and --tax-config (provider settings).",
      });
    }
    const path = yield* Path.Path;
    const catalog = yield* loadProvisioningCatalog(options.directory);
    const read = readProfileDocument(
      CatalogTaxSetup,
      path.resolve(options.taxesFile)
    );
    const setup = yield* read;
    yield* Effect.try({
      catch: (cause) =>
        new DestinationError({
          cause,
          message:
            cause instanceof Error
              ? cause.message
              : "Invalid catalog tax assignments.",
        }),
      try: () => {
        validateCatalogTaxSetup(setup, catalog.catalogs);
      },
    });
    return {
      catalog,
      configFile: path.resolve(options.taxConfigFile),
      read: readSourceFile(read),
      setup,
    };
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DestinationError
        ? cause
        : new DestinationError({
            cause,
            message:
              "Could not read tax setup JSON. Check --taxes, --tax-config and the catalog profile.",
          })
    )
  );

interface ProductTaxSource {
  readonly definition: AnySelfContainedMigrationDefinition;
  readonly key: string;
  readonly versionInputs?: Schema.Json;
}

const ProductTaxItem = Schema.Struct({ definitionId: Schema.NonEmptyString });

/** Each Product assignment can fail and retry independently. */
export const makeTaxDefinition = (options: {
  readonly dependencies: readonly AnySelfContainedMigrationDefinition[];
  readonly products?: readonly ProductTaxSource[];
  readonly productDefinitions?: readonly AnySelfContainedMigrationDefinition[];
  readonly readProducts?: Effect.Effect<readonly ProductTaxSource[], unknown>;
  readonly revision: readonly Schema.Json[];
  readonly apply: (
    products: ReadonlyMap<string, string>
  ) => Effect.Effect<
    void,
    DestinationError,
    Tracking | MigrationReferenceLookup
  >;
  readonly store: ProvisioningStore;
}) => {
  const products = options.products ?? [];
  const definitions =
    options.productDefinitions ?? products.map(({ definition }) => definition);
  return MigrationDefinition.make({
    dependencies: {
      required: [
        ...new Set([
          ...options.dependencies.map(({ id }) => id),
          ...definitions.map(({ id }) => id),
        ]),
      ],
    },
    group: "provision",
    id: "product-tax-assignments",
    process: ({
      item: {
        item: {
          key,
          payload: { definitionId },
        },
      },
    }) =>
      Effect.gen(function* () {
        const definition = definitions.find(({ id }) => id === definitionId);
        if (!definition) {
          return yield* new DestinationError({
            message: `Unknown Product tax assignment: ${key}`,
          });
        }
        const lookup = yield* MigrationReferenceLookup;
        const reference = yield* lookup.lookup({
          definition,
          sourceIdentityKey: key,
        });
        if (
          reference?.status !== "migrated" ||
          !Schema.is(Schema.Struct({ id: Schema.NonEmptyString }))(
            reference.trackingRecord
          )
        ) {
          return yield* new DestinationError({
            message: `Tax setup requires a successfully migrated Product: ${key}`,
          });
        }
        yield* options.apply(new Map([[key, reference.trackingRecord.id]]));
      }),
    source: documentRows(
      ProductTaxItem,
      (options.readProducts ?? Effect.succeed(products)).pipe(
        Effect.map((products) =>
          products.map(({ key, definition, versionInputs }) => ({
            key,
            item: { definitionId: definition.id },
            inputs: [options.revision, versionInputs ?? null],
          }))
        )
      ),
      SourceIdentity.make({
        id: "product-tax-assignment@v1",
        schema: SourceIdentity.key("key", Schema.NonEmptyString),
      })
    ),
    store: options.store,
  });
};
