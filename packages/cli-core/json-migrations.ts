import { createHash } from "node:crypto";

import { Effect, FileSystem, Schema } from "effect";
import type { Layer, Path } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationReferenceLookup,
  SourceError,
  SourceIdentity,
  Tracking,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationStore,
  MigrationStoreError,
} from "migrate-sdk";
import {
  DocumentFetchers,
  DocumentParsers,
  DocumentSource,
} from "migrate-sdk/sources/document";
import { FileMigrationStorePlatform } from "migrate-sdk/stores/file";

export const ProvisionedResource = Schema.Struct({
  id: Schema.NonEmptyString,
  key: Schema.NonEmptyString,
});
export type ProvisionedResource = typeof ProvisionedResource.Type;

const tracking = Tracking.record({
  id: "domain-resource@v1",
  schema: ProvisionedResource,
});

const sourceIdentity = SourceIdentity.make({
  id: "domain-resource-key@v1",
  schema: SourceIdentity.key("key", Schema.NonEmptyString),
});

export interface DocumentRow<A> {
  readonly key: string;
  readonly item: A;
  readonly inputs?: Schema.Json;
}

/** A fetch reads the authored input again for discovery and targeted lookup. */
export const documentRows = <A>(
  schema: Schema.Codec<A, A>,
  read: Effect.Effect<readonly DocumentRow<A>[], unknown>,
  identity = sourceIdentity
) => {
  const row = Schema.Struct({
    key: Schema.NonEmptyString,
    payload: schema,
    inputs: Schema.optionalKey(Schema.Json),
  });
  const documentSchema = Schema.Struct({ rows: Schema.Array(row) });
  const encodeDocument = Schema.encodeEffect(
    Schema.fromJsonString(documentSchema)
  );
  const fetcher = DocumentFetchers.effect({
    cursorSchema: Schema.Null,
    read: () =>
      read.pipe(
        Effect.map((rows) => ({
          rows: rows.map(({ item, ...fields }) => ({
            ...fields,
            payload: item,
          })),
        })),
        Effect.flatMap((resource) =>
          encodeDocument(resource).pipe(
            Effect.map((text) => ({
              resource,
              // Restart discovery if rows shift between cursor windows.
              fingerprint: createHash("sha256").update(text).digest("hex"),
            }))
          )
        ),
        Effect.mapError(
          (cause) =>
            new SourceError({
              cause,
              message: "Unable to read migration source document",
            })
        )
      ),
  });
  return DocumentSource.make({
    batchSize: 50,
    countTotal: ({ countResource }) =>
      fetcher.read(null).pipe(Effect.flatMap(countResource)),
    fetcher,
    parser: DocumentParsers.schema("migration-source-rows", documentSchema),
    selector: { item: (document) => document.rows },
    identity: {
      id: identity.id,
      schema: identity.schema,
      key: ({ item }) => item.key,
    },
    lookup: { kind: "scan" },
    version: { kind: "content-hash" },
  });
};

/** JSON is the encoded representation of the domain input, including Redacted fields. */
export const decodeJsonInputs = <A, I>(
  schema: Schema.Codec<A, I>,
  json: string
) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.toCodecJson(Schema.Array(schema)))
  )(json, {
    onExcessProperty: "error",
  });

export const readJsonInputs = <A, I>(
  schema: Schema.Codec<A, I>,
  path: string
) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(path)),
    Effect.flatMap((json) => decodeJsonInputs(schema, json))
  );

export const readSourceFile = <A, E>(
  read: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>
) => read.pipe(Effect.provide(FileMigrationStorePlatform.node));

export const jsonInputSchema = <A, I>(schema: Schema.Codec<A, I>) => {
  const document = Schema.toJsonSchemaDocument(
    Schema.toEncoded(Schema.toCodecJson(Schema.Array(schema))),
    { onExcessProperty: "error" }
  );
  return {
    $defs: document.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
  };
};

export interface ProvisioningReferences {
  /** Resolves one already-migrated record, never a global provider ID map. */
  readonly get: (
    definition: AnySelfContainedMigrationDefinition,
    key: string
  ) => Effect.Effect<ProvisionedResource, DestinationError>;
}

/** A provider plugin returns the same entity shape used by domain application code. */
export interface JsonMigrationDestination<A, B, BI> {
  readonly entity: Schema.Codec<B, BI>;
  readonly reference: (entity: B, input: A) => ProvisionedResource;
  readonly write: (
    input: A,
    references: ProvisioningReferences,
    previous?: ProvisionedResource
  ) => Effect.Effect<B, DestinationError, Tracking | MigrationReferenceLookup>;
}

export type JsonMigrationInput<A, I> = {
  readonly schema: Schema.Codec<A, I>;
  readonly key: (item: A) => string;
} & (
  | {
      readonly read: Effect.Effect<readonly A[], unknown>;
      readonly items?: never;
    }
  | { readonly items: readonly A[]; readonly read?: never }
);

export const validateJsonMigrationKeys = <A>(
  id: string,
  items: readonly A[],
  key: (item: A) => string
) =>
  Effect.gen(function* () {
    const keys = new Set<string>();
    for (const item of items) {
      const value = key(item);
      if (!value || keys.has(value)) {
        return yield* new DestinationError({
          message: `${id}: duplicate or empty source key`,
        });
      }
      keys.add(value);
    }
  });

/** Build only after every selected file and its references have been validated. */
export const makeJsonMigration = <A, I, B, BI>(options: {
  readonly id: string;
  readonly group: string;
  readonly input: JsonMigrationInput<A, I>;
  readonly destination: JsonMigrationDestination<A, B, BI>;
  readonly store: Layer.Layer<MigrationStore, MigrationStoreError>;
  readonly dependencies?: readonly AnySelfContainedMigrationDefinition[];
  /** Include source dependencies and mapping revision in each record's version. */
  readonly revision: string;
}) =>
  Effect.gen(function* () {
    const codec = Schema.toCodecJson(options.input.schema);
    yield* validateJsonMigrationKeys(
      options.id,
      options.input.items ?? [],
      options.input.key
    );
    return MigrationDefinition.make({
      dependencies: {
        required: (options.dependencies ?? []).map(
          (definition) => definition.id
        ),
      },
      execution: { process: { concurrency: 1 } },
      group: options.group,
      id: options.id,
      process: (entry, { previousState }) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeEffect(codec)(
            entry.item.item.payload
          ).pipe(
            Effect.mapError(
              (cause) =>
                new DestinationError({
                  cause,
                  message: `${options.id}: invalid source item`,
                })
            )
          );
          const lookup = yield* MigrationReferenceLookup;
          const references: ProvisioningReferences = {
            get: (definition, key) =>
              lookup.lookup({ definition, sourceIdentityKey: key }).pipe(
                Effect.flatMap((resource) =>
                  resource?.status === "migrated"
                    ? Schema.decodeUnknownEffect(ProvisionedResource)(
                        resource.trackingRecord
                      ).pipe(
                        Effect.mapError(
                          () =>
                            new DestinationError({
                              message: `${definition.id}: invalid resource reference`,
                            })
                        )
                      )
                    : Effect.fail(
                        new DestinationError({
                          message: `${definition.id}: referenced source has not migrated`,
                        })
                      )
                ),
                Effect.mapError(
                  () =>
                    new DestinationError({
                      message: `${definition.id}: resource reference unavailable`,
                    })
                )
              ),
          };
          const entity = yield* options.destination.write(
            input,
            references,
            previousState?.trackingRecord
          );
          const validated = yield* Schema.decodeUnknownEffect(
            Schema.toType(options.destination.entity)
          )(entity).pipe(
            Effect.mapError(
              () =>
                new DestinationError({
                  message: `${options.id}: destination returned an invalid domain entity`,
                })
            )
          );
          const reference = yield* Schema.decodeUnknownEffect(
            ProvisionedResource
          )(options.destination.reference(validated, input)).pipe(
            Effect.mapError(
              () =>
                new DestinationError({
                  message: `${options.id}: destination returned an invalid identity`,
                })
            )
          );
          if (reference.key !== options.input.key(input)) {
            return yield* new DestinationError({
              message: `${options.id}: destination changed the source key`,
            });
          }
          yield* Tracking.setRecord(reference);
        }),
      source: documentRows(
        Schema.toEncoded(codec),
        (options.input.read ?? Effect.succeed(options.input.items ?? [])).pipe(
          Effect.flatMap(
            Effect.forEach((item: A) =>
              Schema.encodeEffect(codec)(item).pipe(
                Effect.map((encoded) => ({
                  key: options.input.key(item),
                  item: encoded,
                  inputs: options.revision,
                }))
              )
            )
          )
        )
      ),
      store: options.store,
      tracking,
    });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "DestinationError"
        ? error
        : new DestinationError({
            message: `${options.id}: invalid migration source data`,
          })
    )
  );
