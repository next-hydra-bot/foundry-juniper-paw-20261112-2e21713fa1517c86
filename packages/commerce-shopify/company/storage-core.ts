import { createHash, randomUUID } from "node:crypto";

import {
  decodeJsonString,
  encodeJsonString,
  StoreConflict,
  StoreError,
  StoreVersion,
  VersionedKeyValueStore,
} from "@repo/versioned-store";
import type { Versioned, VersionedStoreKey } from "@repo/versioned-store";
import { Effect, Layer, Option, Schema } from "effect";

export type CompanyStorageRequest = (
  query: string,
  variables?: Readonly<Record<string, Schema.Json>>
) => Effect.Effect<Record<string, Schema.Json>, unknown>;
const decodeCompanyResource = <S extends Schema.Top>(
  schema: S,
  value: Schema.Json | undefined
) => Schema.decodeUnknownEffect(schema)(value);
class CompanyStorageTransportFailure extends Schema.TaggedError<CompanyStorageTransportFailure>()(
  "CompanyStorageTransportFailure",
  {}
) {}

const Envelope = Schema.Struct({
  encoded: Schema.NullOr(Schema.String),
  key: Schema.String,
  revision: Schema.String,
});
const Metafield = Schema.Struct({
  compareDigest: Schema.String,
  key: Schema.String,
  value: Schema.String,
});
const PageResponse = Schema.Struct({
  metafields: Schema.Struct({
    nodes: Schema.Array(Metafield),
    pageInfo: Schema.Struct({
      endCursor: Schema.NullOr(Schema.String),
      hasNextPage: Schema.Boolean,
    }),
  }),
});
const fields = "key value compareDigest";
const nativeKey = (key: string) =>
  createHash("sha256").update(key).digest("hex");

const failure = (
  key: string,
  operation: StoreError["operation"],
  cause: unknown
) =>
  new StoreError({
    cause,
    key,
    message: "Shopify company storage is unavailable",
    operation,
    reason: "unavailable",
  });
/** App-owned Shop metafields are private. Deletion uses CAS tombstones to preserve concurrency guarantees. */
export const companyStorageLayerWith = (
  collection: string,
  request: CompanyStorageRequest
) =>
  Layer.sync(VersionedKeyValueStore, () => {
    const admin = {
      request: (
        query: string,
        variables?: Readonly<Record<string, Schema.Json>>
      ) =>
        request(query, variables).pipe(
          Effect.mapError(() => new CompanyStorageTransportFailure({}))
        ),
    };
    const namespace = ["invitations", "identities"].includes(collection)
      ? `$app:company_${collection}`
      : `$app:company_records_${createHash("sha256").update(collection).digest("hex").slice(0, 32)}`;
    const read = (key: VersionedStoreKey) =>
      admin
        .request(
          `query CompanyStorageRead($namespace:String!,$key:String!) { shop { id metafield(namespace:$namespace,key:$key) { ${fields} } } }`,
          { key: nativeKey(key), namespace }
        )
        .pipe(
          Effect.flatMap((data) =>
            decodeCompanyResource(
              Schema.Struct({
                id: Schema.String,
                metafield: Schema.NullOr(Metafield),
              }),
              data.shop
            )
          ),
          Effect.mapError((cause) => failure(key, "read", cause))
        );
    const unpack = (field: typeof Metafield.Type) =>
      Schema.decodeEffect(Schema.fromJsonString(Envelope))(field.value);
    const write = (
      key: VersionedStoreKey,
      ownerId: string,
      compareDigest: string | null,
      encoded: string | null,
      operation: "insert" | "update" | "remove"
    ) =>
      Effect.gen(function* () {
        const value = yield* Schema.encodeEffect(
          Schema.fromJsonString(Envelope)
        )({ encoded, key, revision: randomUUID() });
        const data = yield* admin.request(
          `mutation CompanyStorageWrite($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { userErrors { code message } } }`,
          {
            metafields: [
              {
                compareDigest,
                key: nativeKey(key),
                namespace,
                ownerId,
                type: "json",
                value,
              },
            ],
          }
        );
        const result = yield* decodeCompanyResource(
          Schema.Struct({
            userErrors: Schema.Array(
              Schema.Struct({
                code: Schema.NullOr(Schema.String),
                message: Schema.String,
              })
            ),
          }),
          data.metafieldsSet
        );
        if (
          result.userErrors.some(
            (error) =>
              error.code === "INVALID_COMPARE_DIGEST" ||
              error.code === "STALE_OBJECT"
          )
        ) {
          return yield* new StoreConflict({
            key,
            message: "Company storage changed during the operation",
            operation,
          });
        }
        if (result.userErrors.length) {
          return yield* failure(
            key,
            operation,
            new Error("Shopify rejected company storage")
          );
        }
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "StoreConflict" || error._tag === "StoreError"
            ? error
            : failure(key, operation, error)
        )
      );
    return VersionedKeyValueStore.of({
      get: <S extends Schema.Top>(key: VersionedStoreKey, schema: S) =>
        Effect.gen(function* () {
          const { metafield } = yield* read(key);
          if (!metafield) {
            return Option.none<Versioned<S["Type"]>>();
          }
          const stored = yield* unpack(metafield);
          if (stored.key !== key) {
            return yield* failure(
              key,
              "read",
              new Error("Company storage identity mismatch")
            );
          }
          if (stored.encoded === null) {
            return Option.none<Versioned<S["Type"]>>();
          }
          return Option.some({
            value: yield* decodeJsonString(schema, stored.encoded),
            version: StoreVersion.make(metafield.compareDigest),
          });
        }).pipe(Effect.mapError((cause) => failure(key, "read", cause))),
      insert: <S extends Schema.Top>(
        key: VersionedStoreKey,
        schema: S,
        value: S["Type"]
      ) =>
        Effect.gen(function* () {
          const shop = yield* read(key);
          if (shop.metafield) {
            const stored = yield* unpack(shop.metafield);
            if (stored.key !== key || stored.encoded !== null) {
              return yield* new StoreConflict({
                key,
                operation: "insert",
                message: "Company record already exists",
              });
            }
          }
          const encoded = yield* encodeJsonString(schema, value);
          yield* write(
            key,
            shop.id,
            shop.metafield?.compareDigest ?? null,
            encoded,
            "insert"
          );
        }).pipe(
          Effect.mapError((error) =>
            error._tag === "StoreConflict"
              ? error
              : failure(key, "insert", error)
          )
        ),
      remove: (key, current) =>
        read(key).pipe(
          Effect.flatMap((shop) =>
            write(key, shop.id, current.version, null, "remove")
          )
        ),
      update: <S extends Schema.Top>(
        key: VersionedStoreKey,
        schema: S,
        current: Versioned<S["Type"]>,
        next: S["Type"]
      ) =>
        Effect.gen(function* () {
          const shop = yield* read(key);
          const encoded = yield* encodeJsonString(schema, next);
          yield* write(key, shop.id, current.version, encoded, "update");
        }).pipe(
          Effect.mapError((error) =>
            error._tag === "StoreConflict"
              ? error
              : failure(key, "update", error)
          )
        ),
      values: <S extends Schema.Top>(schema: S) =>
        Effect.gen(function* () {
          const values: Versioned<S["Type"]>[] = [];
          let after: string | null = null;
          const cursors = new Set<string>();
          while (true) {
            const data: Record<string, Schema.Json> = yield* admin.request(
              `query CompanyStorageValues($namespace:String!,$after:String) { shop { metafields(namespace:$namespace,first:100,after:$after) { nodes { ${fields} } pageInfo { hasNextPage endCursor } } } }`,
              { namespace, after }
            );
            const shop: typeof PageResponse.Type = yield* decodeCompanyResource(
              PageResponse,
              data.shop
            );
            for (const field of shop.metafields.nodes) {
              const stored = yield* unpack(field);
              if (nativeKey(stored.key) !== field.key) {
                return yield* failure(
                  collection,
                  "read",
                  new Error("Company storage identity mismatch")
                );
              }
              if (stored.encoded !== null) {
                values.push({
                  value: yield* decodeJsonString(schema, stored.encoded),
                  version: StoreVersion.make(field.compareDigest),
                });
              }
            }
            const page = shop.metafields.pageInfo;
            if (!page.hasNextPage) {
              return values;
            }
            if (!page.endCursor || cursors.has(page.endCursor)) {
              return yield* failure(
                collection,
                "read",
                new Error("Invalid company storage pagination")
              );
            }
            const nextCursor: string = page.endCursor;
            after = nextCursor;
            cursors.add(nextCursor);
          }
        }).pipe(Effect.mapError((cause) => failure(collection, "read", cause))),
    });
  });
