import { createHash } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import { failureMessage } from "@repo/cli-core/user-error";
import { Console, Effect, Option, Schema } from "effect";
import type { ConfigProvider, Effect as EffectType } from "effect";
import { Command, Flag, CliError } from "effect/cli";
import { FileMigrationStore } from "migrate-sdk/stores/file";

import { CmsCommerceMigrations } from "./commerce";
import { defaultContent } from "./default-content";
import { contentMigrationNames, makeContentRegistry } from "./migrations";
import type { ContentDestination } from "./migrations";
import { ContentModel, profileSchema, jsonSchema } from "./model";
import type { ContentModel as Model } from "./model";
import {
  contentCategoryKeys,
  validateContentCategories,
  loadContentProfile,
  assetPath,
} from "./profile";

const error = (cause: unknown) =>
  new CliError.UserError({
    cause: undefined,
    userMessage:
      failureMessage(cause) ??
      (typeof cause === "object" && cause && "message" in cause
        ? String(cause.message)
        : "CMS content command failed."),
  });
const attempt = <A>(fn: () => A) => Effect.try({ catch: error, try: fn });
const outputFlag = Flag.String("output").pipe(Flag.optional);
const directoryFlag = Flag.String("directory");
const modelFlag = Flag.String("model").pipe(Flag.optional);
const print = (value: unknown, output: Option.Option<string>) =>
  attempt(() => {
    const json = `${JSON.stringify(value, null, 2)}\n`;
    if (Option.isSome(output)) {
      writeFileSync(output.value, json);
    } else {
      process.stdout.write(json);
    }
  });
export function contentAuthoringCommands(installed: () => Model) {
  return [
    Command.make("model", { output: outputFlag }, ({ output }) =>
      print(installed(), output)
    ).pipe(Command.withDescription("Export the installed CMS authoring model")),
    Command.make(
      "schema",
      { model: modelFlag, output: outputFlag },
      ({ output, model }) =>
        Effect.gen(function* () {
          const selected = yield* attempt(() =>
            Option.isSome(model)
              ? Schema.decodeUnknownSync(ContentModel)(
                  JSON.parse(readFileSync(model.value, "utf-8"))
                )
              : installed()
          );
          const schema = jsonSchema(profileSchema(selected));
          // These constraints supplement the same full Effect schemas used by validate/setup.
          yield* print({ ...schema, "x-content-model": selected }, output);
        })
    ).pipe(
      Command.withDescription(
        "Export the Effect-derived content profile JSON Schema and selected model"
      )
    ),
    Command.make(
      "init",
      { directory: directoryFlag, model: modelFlag },
      ({ directory, model }) =>
        attempt(() => {
          const selected = Option.isSome(model)
            ? Schema.decodeUnknownSync(ContentModel)(
                JSON.parse(readFileSync(model.value, "utf-8"))
              )
            : installed();
          const profile = defaultContent(selected);
          const files = {
            "announcements.json": profile.announcements,
            "assets.json": profile.assets,
            "content-model.json": profile.model,
            "entries.json": profile.entries,
            "navigation.json": profile.navigation,
          };
          for (const file of Object.keys(files)) {
            if (existsSync(resolve(directory, file))) {
              throw new Error(
                `File already exists: ${resolve(directory, file)}`
              );
            }
          }
          mkdirSync(directory, { recursive: true });
          for (const [file, value] of Object.entries(files)) {
            writeFileSync(
              resolve(directory, file),
              `${JSON.stringify(value, null, 2)}\n`,
              { flag: "wx" }
            );
          }
          return profile;
        }).pipe(
          Effect.flatMap((profile) =>
            Console.log(
              `Initialized editable CMS content: ${
                profile.entries.length
              } entries in ${directory}`
            )
          )
        )
    ).pipe(
      Command.withDescription(
        "Write portable starter content into a new editable folder"
      )
    ),
    Command.make("validate", { directory: directoryFlag }, ({ directory }) =>
      attempt(() => loadContentProfile(directory, installed())).pipe(
        Effect.flatMap((profile) =>
          Console.log(
            `Valid CMS profile: ${profile.entries.length} entries, ${
              profile.assets.length
            } assets.`
          )
        )
      )
    ).pipe(
      Command.withDescription(
        "Validate all content files, routes, locales and references offline"
      )
    ),
  ];
}
export const contentSetupFlags = {
  bindingsFile: Flag.String("bindings").pipe(
    Flag.optional,
    Flag.withDescription(
      "Commerce binding file when it is not bindings.json in the commerce source directory"
    )
  ),
  commerceDirectory: Flag.String("commerce-directory").pipe(
    Flag.optional,
    Flag.withDescription(
      "Commerce source profile whose category migrations pages depend on"
    )
  ),
  directory: directoryFlag,
  plan: Flag.Boolean("plan").pipe(
    Flag.withDefault(false),
    Flag.withDescription(
      "Traverse and validate the source; print migrations without contacting the CMS"
    )
  ),
  stateDirectory: Flag.String("state-directory").pipe(
    Flag.withDefault(".migrate")
  ),
};
export const setupContent = <E, R, E2, R2>(
  options: {
    directory: string;
    stateDirectory: string;
    plan: boolean;
    commerceDirectory: Option.Option<string>;
    bindingsFile: Option.Option<string>;
  },
  installed: Model,
  prepare: (directory: string) => EffectType.Effect<ContentDestination, E, R>,
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E2, R2>
) =>
  Effect.gen(function* () {
    const profile = yield* attempt(() =>
      loadContentProfile(options.directory, installed)
    );
    const keys = contentCategoryKeys(profile);
    const service = Option.getOrUndefined(
      yield* Effect.serviceOption(CmsCommerceMigrations)
    );
    const commerceDirectory = Option.getOrUndefined(options.commerceDirectory);
    let source:
      | { categoryMigrationId: string; categoryKeys: readonly string[] }
      | undefined;
    if (keys.length) {
      if (!commerceDirectory) {
        return yield* error(
          new Error(
            "Product collections need --commerce-directory pointing to the commerce source profile."
          )
        );
      }
      if (!service) {
        return yield* error(
          new Error(
            "The selected commerce provider has not installed its CMS migration contribution."
          )
        );
      }
      source = yield* service.source(commerceDirectory);
      yield* attempt(() => {
        validateContentCategories(profile, source!.categoryKeys);
      });
    }
    if (options.plan) {
      yield* Console.log(
        JSON.stringify(
          {
            assets: profile.assets.length,
            categories: keys,
            entries: profile.entries.length,
            migrations: [
              ...(source ? [source.categoryMigrationId] : []),
              ...contentMigrationNames.map(
                (name) => `${profile.model.key}-cms-${name}`
              ),
            ],
            status: "plan",
          },
          null,
          2
        )
      );
      return;
    }
    const commerce =
      source && service && commerceDirectory
        ? yield* service.prepare(
            yield* configProvider,
            commerceDirectory,
            options.stateDirectory,
            Option.getOrUndefined(options.bindingsFile)
          )
        : undefined;
    const destination = yield* prepare(resolve(options.directory));
    const namespace = createHash("sha256")
      .update(JSON.stringify([destination.target, commerce?.target]))
      .digest("hex");
    const assetVersions = yield* attempt(() =>
      Object.fromEntries(
        profile.assets.map((asset) => {
          const source = assetPath(options.directory, asset.source);
          return [
            asset.key,
            /^https?:\/\//u.test(source)
              ? source
              : createHash("sha256").update(readFileSync(source)).digest("hex"),
          ];
        })
      )
    );
    const registry = yield* makeContentRegistry(
      profile,
      destination,
      FileMigrationStore.layer({
        directory: resolve(options.stateDirectory, namespace),
      }),
      assetVersions,
      commerce
    );
    const summary = yield* provisionMigrationGroup(registry, "cms-content");
    yield* Console.log(
      JSON.stringify(
        {
          entries: profile.entries.length,
          migrations: summary.definitions.map((item) => ({
            id: item.definitionId,
            status: item.status,
          })),
          publicationTarget: destination.publicationTarget,
          runId: summary.runId,
          status: "ready",
          target: destination.target,
        },
        null,
        2
      )
    );
  }).pipe(
    Effect.mapError((cause) =>
      error(
        typeof cause === "object" && cause && "failures" in cause
          ? new Error(JSON.stringify(cause.failures))
          : cause
      )
    )
  );
