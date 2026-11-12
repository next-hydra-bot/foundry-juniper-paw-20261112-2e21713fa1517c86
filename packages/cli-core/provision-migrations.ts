import { Effect, Schema } from "effect";
import { MigrationExecution } from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationDefinitionRegistry,
  MigrationRunSummary,
} from "migrate-sdk";

export class ProvisioningRunFailed extends Schema.TaggedError<ProvisioningRunFailed>()(
  "ProvisioningRunFailed",
  {
    failedDefinitions: Schema.optional(Schema.Array(Schema.String)),
    failures: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({ definitionId: Schema.String, message: Schema.String })
      )
    ),
    message: Schema.String,
    runId: Schema.optionalKey(Schema.String),
  }
) {}

/** Await SDK completion inside its scope; starting a run is not provisioning success. */
export const provisionMigrationGroup = (
  registry: MigrationDefinitionRegistry<
    readonly AnySelfContainedMigrationDefinition[]
  >,
  group: string
): Effect.Effect<MigrationRunSummary, ProvisioningRunFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* MigrationExecution.make({ registry })
        .run({
          group,
          withDependencies: true,
        })
        .pipe(
          Effect.mapError(
            () =>
              new ProvisioningRunFailed({
                message:
                  "Unable to start provisioning. Check migration dependencies and recorded state.",
              })
          )
        );
      const fail = (summary?: MigrationRunSummary) =>
        Effect.gen(function* () {
          const report = yield* registry
            .messages({ group, withDependencies: true })
            .pipe(Effect.orElseSucceed(() => undefined));
          const failures = report?.messages
            .filter(
              (message) =>
                message.runId === started.runId && message.kind === "item-error"
            )
            .map(({ definitionId, message }) => ({ definitionId, message }));
          // Repeated item errors need one diagnostic per stage and message.
          const unique = [
            ...new Map(
              failures?.map((failure) => [JSON.stringify(failure), failure])
            ).values(),
          ];
          return yield* new ProvisioningRunFailed({
            failedDefinitions: summary?.definitions
              .filter((definition) => definition.status === "failed")
              .map((definition) => definition.definitionId),
            failures: unique.slice(0, 10),
            message:
              "Provisioning did not complete successfully; inspect the recorded run before retrying.",
            runId: started.runId,
          });
        });
      if (started.kind === "completed") {
        if (started.summary.status !== "succeeded") {
          return yield* fail(started.summary);
        }
        return started.summary;
      }
      if (!started.handle) {
        return yield* fail();
      }
      const completed = yield* started.handle.wait;
      if (
        completed.kind !== "finished" ||
        completed.summary.status !== "succeeded"
      ) {
        return yield* fail(
          completed.kind === "finished" ? completed.summary : undefined
        );
      }
      return completed.summary;
    })
  );
