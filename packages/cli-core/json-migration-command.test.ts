import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Console, Effect, FileSystem, Schema } from "effect";
import { Command } from "effect/cli";

import {
  makeJsonProvisionCommand,
  makeJsonSchemaCommand,
} from "./json-migration-command";
import { composeProvisioningInputModels } from "./provisioning-input-models";

describe("Domain provisioning", () => {
  it.effect(
    "writes a standalone JSON schema for agent inputs without credentials",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const output = `${directory}/customers.schema.json`;
        const command = makeJsonSchemaCommand({
          customers: Schema.Struct({
            email: Schema.Redacted(Schema.NonEmptyString),
            key: Schema.NonEmptyString,
          }),
        });
        yield* Command.runWith(command, { version: "0.0.0" })([
          "customers",
          "--output",
          output,
        ]);
        const document = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({ type: Schema.Literal("array") })
          )
        )(yield* fs.readFileString(output));
        expect(document.type).toBe("array");
      }).pipe(Effect.provide(NodeServices.layer))
  );
  it.effect(
    "plans validated JSON without contacting the provider or creating state",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const input = `${directory}/customers.json`;
        yield* fs.writeFileString(input, '[{"key":"customer"}]');
        const schema = Schema.Struct({ key: Schema.NonEmptyString });
        const entitySchema = Schema.Struct({
          key: Schema.NonEmptyString,
          id: Schema.NonEmptyString,
        });
        let writes = 0;
        const output: unknown[][] = [];
        const command = makeJsonProvisionCommand({
          id: "customers",
          key: (item: typeof schema.Type) => item.key,
          prepare: Effect.succeed({
            destination: {
              entity: entitySchema,
              reference: (entity: typeof entitySchema.Type) => ({
                id: entity.id,
                key: entity.key,
              }),
              write: (item: typeof schema.Type) =>
                Effect.sync(() => {
                  writes += 1;
                  return { ...item, id: "native" };
                }),
            },
            target: "test-shop",
          }),
          revision: "v1",
          schema,
        });
        yield* Command.runWith(command, { version: "0.0.0" })([
          "--input",
          input,
          "--state-directory",
          `${directory}/state`,
          "--plan",
        ]).pipe(
          Effect.provideService(Console.Console, {
            ...globalThis.console,
            log: (...values: readonly unknown[]) => {
              output.push([...values]);
            },
          })
        );
        expect(output.flat().join(" ")).toContain("1 records");
        expect(yield* fs.exists(`${directory}/state`)).toBeFalsy();
        expect(writes).toBe(0);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "rejects conflicting recipe schema definitions instead of choosing by order",
    () =>
      Effect.gen(function* () {
        const first = Schema.Struct({ key: Schema.NonEmptyString });
        const other = Schema.Struct({ id: Schema.NonEmptyString });
        expect(
          yield* composeProvisioningInputModels([
            { customers: first },
            { customers: first },
          ])
        ).toEqual({ customers: first });
        expect(
          yield* composeProvisioningInputModels([
            { customers: first },
            { customers: other },
          ]).pipe(Effect.flip)
        ).toMatchObject({
          _tag: "ProvisioningInputModelConflict",
          model: "customers",
        });
      })
  );
});
