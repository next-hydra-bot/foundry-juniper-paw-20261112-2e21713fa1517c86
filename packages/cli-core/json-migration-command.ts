import { createHash } from "node:crypto";

import { Console, Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Effect as EffectType } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { MigrationDefinitionRegistry } from "migrate-sdk";
import { FileMigrationStore } from "migrate-sdk/stores/file";

import { phase, renderReport, withCommandOutput } from "./command-output";
import {
  jsonInputSchema,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This command composes SDK definitions; the factory is not an Effect service constructor.
  makeJsonMigration,
  readJsonInputs,
  readSourceFile,
  validateJsonMigrationKeys,
} from "./json-migrations";
import type { JsonMigrationDestination } from "./json-migrations";
import { provisionMigrationGroup } from "./provision-migrations";
import {
  composeProvisioningInputModels,
  ProvisioningInputModels,
} from "./provisioning-input-models";
import { migrationPlanReport, migrationRunReport } from "./provisioning-output";

const userError = (cause: unknown) =>
  new CliError.UserError({
    cause,
    userMessage:
      "Provisioning failed. Check the source input and recorded Migrate state before retrying.",
  });

/** Provider-owned commands supply a destination and a non-secret target identity. */
export const makeJsonProvisionCommand = <A, I, B, BI, E, R>(options: {
  readonly id: string;
  readonly schema: Schema.Codec<A, I>;
  readonly key: (input: A) => string;
  readonly prepare: EffectType.Effect<
    {
      readonly destination: JsonMigrationDestination<A, B, BI>;
      readonly target: string;
    },
    E,
    R
  >;
  readonly revision: string;
}) =>
  Command.make(
    "provision",
    {
      input: Flag.String("input"),
      plan: Flag.Boolean("plan").pipe(
        Flag.withDefault(false),
        Flag.withDescription(
          "Validate input and show migration order without contacting the destination"
        )
      ),
      stateDirectory: Flag.String("state-directory").pipe(
        Flag.withDefault(".migrate")
      ),
    },
    ({ input, plan, stateDirectory }) =>
      withCommandOutput(
        {
          title: "Provision data",
          context: options.id,
          failureNote:
            "Earlier writes may remain. Inspect the recorded Migrate run before retrying.",
        },
        (style) =>
          Effect.gen(function* () {
            const items = yield* phase(
              { group: "Inputs", title: "Read and validate source records" },
              readJsonInputs(options.schema, input)
            );
            yield* validateJsonMigrationKeys(options.id, items, options.key);
            const { target, destination } = yield* options.prepare;
            const path = yield* Path.Path;
            const namespace = createHash("sha256")
              .update(JSON.stringify([options.id, target]))
              .digest("hex");
            const definition = yield* makeJsonMigration({
              destination,
              group: "provision",
              id: options.id,
              input: {
                read: readSourceFile(readJsonInputs(options.schema, input)),
                key: options.key,
                schema: options.schema,
              },
              revision: options.revision,
              store: FileMigrationStore.layer({
                directory: path.resolve(stateDirectory, namespace),
              }),
            });
            const registry = MigrationDefinitionRegistry.make({
              definitions: [definition],
            });
            if (plan) {
              const selected = yield* registry.planRun({
                group: "provision",
                withDependencies: true,
              });
              yield* Console.log(
                renderReport(
                  migrationPlanReport(
                    selected.includedDefinitionIds,
                    `${input} · ${items.length} records`
                  ),
                  style
                )
              );
              return;
            }
            const summary = yield* phase(
              { group: "Data", title: "Apply migration stages" },
              provisionMigrationGroup(registry, "provision")
            );
            yield* Console.log(
              renderReport(migrationRunReport(summary, stateDirectory), style)
            );
          }).pipe(Effect.mapError(userError))
      )
  );

export const makeJsonSchemaCommand = (
  models: Readonly<Record<string, Schema.Codec<unknown, unknown>>>
) =>
  Command.make(
    "schema",
    {
      model: Argument.String("model"),
      output: Flag.String("output").pipe(Flag.optional),
    },
    ({ model, output }) =>
      Effect.gen(function* () {
        const additional = yield* Effect.serviceOption(ProvisioningInputModels);
        const available = yield* composeProvisioningInputModels([
          models,
          Option.getOrElse(additional, () => ({})),
        ]);
        const schema = available[model];
        if (!schema) {
          return yield* new CliError.UserError({
            cause: undefined,
            userMessage: `Unknown input model. Choose: ${Object.keys(available).join(", ")}`,
          });
        }
        const json = yield* Schema.encodeUnknownEffect(
          Schema.fromJsonString(Schema.Json)
        )(jsonInputSchema(schema));
        if (Option.isSome(output)) {
          const fs = yield* FileSystem.FileSystem;
          yield* fs.writeFileString(output.value, `${json}\n`);
        } else {
          yield* Console.log(json);
        }
      })
  );
