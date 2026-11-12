import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Redacted, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinitionRegistry,
  MigrationExecution,
  MigrationStore,
} from "migrate-sdk";
import { FileMigrationStore } from "migrate-sdk/stores/file";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import {
  decodeJsonInputs,
  jsonInputSchema,
  makeJsonMigration,
  readJsonInputs,
  readSourceFile,
} from "./json-migrations";
import { provisionMigrationGroup } from "./provision-migrations";

const Input = Schema.Struct({
  email: Schema.Redacted(Schema.NonEmptyString),
  key: Schema.NonEmptyString,
});
const Entity = Schema.Struct({ ...Input.fields, id: Schema.NonEmptyString });

describe("Domain provisioning", () => {
  it.effect("returns recorded destination errors with the failed run", () =>
    Effect.gen(function* () {
      const definition = yield* makeJsonMigration({
        destination: {
          entity: Entity,
          reference: (entity) => ({ id: entity.id, key: entity.key }),
          write: () =>
            Effect.fail(
              new DestinationError({
                message: "Shopify Admin HTTP 401: invalid access token",
              })
            ),
        },
        group: "provision",
        id: "customers",
        input: {
          items: [{ email: Redacted.make("a@example.test"), key: "customer" }],
          key: (item) => item.key,
          schema: Input,
        },
        revision: "v1",
        store: InMemoryMigrationStore.layer(),
      });
      const result = yield* provisionMigrationGroup(
        MigrationDefinitionRegistry.make({ definitions: [definition] }),
        "provision"
      ).pipe(Effect.flip);
      expect(result.failures).toHaveLength(1);
      expect(result.failures?.[0]?.definitionId).toBe("customers");
      expect(result.failures?.[0]?.message).toContain(
        "Shopify Admin HTTP 401: invalid access token"
      );
    })
  );
  it.effect(
    "fails the group when a destination returns another source key",
    () =>
      Effect.gen(function* () {
        const items = yield* decodeJsonInputs(
          Input,
          '[{"key":"customer","email":"a@example.com"}]'
        );
        const definition = yield* makeJsonMigration({
          destination: {
            entity: Entity,
            reference: (entity) => ({ id: entity.id, key: entity.key }),
            write: (input) =>
              Effect.succeed({ ...input, id: "native", key: "another-source" }),
          },
          group: "provision",
          id: "customers",
          input: { items, key: (item) => item.key, schema: Input },
          revision: "v1",
          store: InMemoryMigrationStore.layer(),
        });
        const registry = MigrationDefinitionRegistry.make({
          definitions: [definition],
        });
        const result = yield* provisionMigrationGroup(
          registry,
          "provision"
        ).pipe(Effect.flip);
        expect(result).toMatchObject({ _tag: "ProvisioningRunFailed" });
      })
  );
  it.effect(
    "decodes JSON using domain codecs and exports the encoded JSON schema",
    () =>
      Effect.gen(function* () {
        const [input] = yield* decodeJsonInputs(
          Input,
          '[{"key":"Customer / 42","email":"a@example.test"}]'
        );
        expect(input).toBeDefined();
        expect(Redacted.isRedacted(input?.email)).toBeTruthy();
        const document = jsonInputSchema(Input);
        expect(JSON.stringify(document)).toContain('"type":"string"');
        expect(
          yield* decodeJsonInputs(
            Input,
            '[{"key":"a","email":"a@example.test","nativeId":"not-input"}]'
          ).pipe(Effect.isFailure)
        ).toBeTruthy();
      })
  );

  it.effect(
    "runs a JSON-backed SDK group, resolves native references, and skips unchanged records",
    () =>
      Effect.gen(function* () {
        const store = InMemoryMigrationStore.layer(
          InMemoryMigrationStore.makeState()
        );
        const items = yield* decodeJsonInputs(
          Input,
          '[{"key":"Customer / 42","email":"a@example.test"}]'
        );
        const writes: string[] = [];
        const customers = yield* makeJsonMigration({
          destination: {
            entity: Entity,
            reference: (entity) => ({ id: entity.id, key: entity.key }),
            write: (input) =>
              Effect.sync(() => {
                writes.push("customer");
                return { ...input, id: "gid://shopify/Customer/42" };
              }),
          },
          group: "provision",
          id: "customers",
          input: { items, key: (input) => input.key, schema: Input },
          revision: "mapping-v1",
          store,
        });
        const MembershipInput = Schema.Struct({
          customerKey: Schema.NonEmptyString,
          key: Schema.NonEmptyString,
        });
        const memberships = yield* makeJsonMigration({
          dependencies: [customers],
          destination: {
            entity: Schema.Struct({
              ...MembershipInput.fields,
              id: Schema.NonEmptyString,
            }),
            reference: (entity) => ({ id: entity.id, key: entity.key }),
            write: (input, references) =>
              references.get(customers, input.customerKey).pipe(
                Effect.map((customer) => {
                  writes.push(customer.id);
                  return { ...input, id: "membership-42" };
                })
              ),
          },
          group: "provision",
          id: "memberships",
          input: {
            items: [{ customerKey: "Customer / 42", key: "member" }],
            key: (input) => input.key,
            schema: MembershipInput,
          },
          revision: "mapping-v1",
          store,
        });
        const registry = MigrationDefinitionRegistry.make({
          definitions: [memberships, customers],
        });
        const first = yield* provisionMigrationGroup(registry, "provision");
        expect(first).toMatchObject({ status: "succeeded" });
        expect(writes).toEqual(["customer", "gid://shopify/Customer/42"]);
        const second = yield* provisionMigrationGroup(registry, "provision");
        expect(second).toMatchObject({ status: "succeeded" });
        expect(writes).toHaveLength(2);
      })
  );

  it.effect("rejects duplicate keys before a destination can write", () =>
    Effect.gen(function* () {
      let writes = 0;
      const items = yield* decodeJsonInputs(
        Input,
        '[{"key":"same","email":"a@example.test"},{"key":"same","email":"b@example.test"}]'
      );
      const result = yield* makeJsonMigration({
        destination: {
          entity: Entity,
          reference: (entity) => ({ id: entity.id, key: entity.key }),
          write: (input) =>
            Effect.sync(() => {
              writes += 1;
              return { ...input, id: "unused" };
            }),
        },
        group: "provision",
        id: "customers",
        input: { items, key: (input) => input.key, schema: Input },
        revision: "v1",
        store: InMemoryMigrationStore.layer(),
      }).pipe(Effect.flip);
      expect(result).toMatchObject({ _tag: "DestinationError" });
      expect(writes).toBe(0);
    })
  );

  it.effect("rereads changed files when resuming from a saved cursor", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped();
      const input = `${directory}/customers.json`;
      const rows = Array.from({ length: 51 }, (_, index) => ({
        key: `customer-${index}`,
        email: "before@example.test",
      }));
      yield* fs.writeFileString(input, JSON.stringify(rows));
      const writes: string[] = [];
      const run = (limit?: number) =>
        Effect.gen(function* () {
          const store = FileMigrationStore.layer({
            directory: `${directory}/state`,
          });
          const definition = yield* makeJsonMigration({
            id: "customers",
            group: "provision",
            store,
            revision: "v1",
            input: {
              schema: Input,
              key: (item) => item.key,
              read: readSourceFile(readJsonInputs(Input, input)),
            },
            destination: {
              entity: Entity,
              reference: ({ id, key }) => ({ id, key }),
              write: (item) =>
                Effect.sync(() => {
                  writes.push(`${item.key}:${Redacted.value(item.email)}`);
                  return { ...item, id: item.key };
                }),
            },
          });
          const registry = MigrationDefinitionRegistry.make({
            definitions: [definition],
          });
          const started = yield* MigrationExecution.make({ registry }).run({
            group: "provision",
            limit,
          });
          if (started.kind !== "completed" && started.handle) {
            yield* started.handle.wait;
          }
          return yield* MigrationStore.pipe(
            Effect.flatMap((state) => state.getSourceCursor(definition.id)),
            Effect.provide(store)
          );
        });
      const cursor = yield* run(50);
      expect(cursor).toBeTruthy();
      expect(writes).toHaveLength(50);
      const [first, ...rest] = rows;
      yield* fs.writeFileString(
        input,
        JSON.stringify([
          { key: "inserted", email: "new@example.test" },
          { ...first, email: "after@example.test" },
          ...rest,
        ])
      );
      yield* run();
      expect(writes.slice(50)).toEqual([
        "inserted:new@example.test",
        "customer-0:after@example.test",
        "customer-50:before@example.test",
      ]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});
