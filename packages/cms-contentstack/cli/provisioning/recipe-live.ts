import { Effect, FileSystem, Layer, Path } from "effect";

import { applyBlockRecipe, blockRecipeTarget } from "./block-recipes";
import {
  CONTENTSTACK_ENVIRONMENTS,
  ContentstackRecipeError,
  ContentstackRecipeReceipt,
} from "./model";
import { ContentstackRecipe } from "./recipe";

export const CONTENTSTACK_RECIPE_VERSION = "4";

const LOCAL_URL_PLACEHOLDER = "__NEXT_HYDRA_LOCAL_URL__";
const PRODUCTION_URL_PLACEHOLDER = "__NEXT_HYDRA_PRODUCTION_URL__";

const recipeError = (
  operation: ContentstackRecipeError["operation"],
  message: string,
  cause: unknown
) => new ContentstackRecipeError({ cause, message, operation });

const normalizeHttpUrl = (name: string, input: string) =>
  Effect.try({
    catch: (cause) =>
      recipeError(
        "validateUrl",
        `${name} must be an absolute http or https URL`,
        cause
      ),
    try: () => {
      const url = new URL(input);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`Unsupported URL protocol ${url.protocol}`);
      }
      return url.toString().replace(/\/$/u, "");
    },
  });

export const contentstackRecipeLayer = Layer.effect(
  ContentstackRecipe,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourceDirectory = yield* path
      .fromFileUrl(new URL("../../recipe/", import.meta.url))
      .pipe(
        Effect.mapError((cause) =>
          recipeError(
            "locate",
            "Could not locate the checked-in Contentstack recipe",
            cause
          )
        )
      );

    return ContentstackRecipe.of({
      materialize: Effect.fn("ContentstackRecipe.materialize")(function* ({
        localUrl,
        productionUrl,
        targetMasterLocale,
        locales = [],
      }) {
        const normalizedLocalUrl = yield* normalizeHttpUrl(
          "Local URL",
          localUrl
        );
        const normalizedProductionUrl = yield* normalizeHttpUrl(
          "Production URL",
          productionUrl
        );
        const normalizedMasterLocale = targetMasterLocale.trim().toLowerCase();

        if (normalizedMasterLocale.length === 0) {
          return yield* recipeError(
            "render",
            "The target stack master locale cannot be empty",
            new Error("Target stack master locale was empty")
          );
        }
        const temporaryRoot = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: "next-hydra-contentstack-" })
          .pipe(
            Effect.mapError((cause) =>
              recipeError(
                "copy",
                "Could not create a temporary Contentstack recipe directory",
                cause
              )
            )
          );
        const directory = path.join(temporaryRoot, "recipe");

        yield* fileSystem
          .copy(sourceDirectory, directory)
          .pipe(
            Effect.mapError((cause) =>
              recipeError(
                "copy",
                "Could not copy the checked-in Contentstack recipe",
                cause
              )
            )
          );

        const entryLocales = new Set([
          "en-us",
          normalizedMasterLocale,
          ...locales.map((locale) => locale.toLowerCase()),
        ]);
        const entriesDirectory = path.join(directory, "entries");
        yield* Effect.gen(function* () {
          for (const type of yield* fileSystem.readDirectory(
            entriesDirectory
          )) {
            for (const locale of ["en-ca", "fr-ca"]) {
              if (!entryLocales.has(locale)) {
                yield* fileSystem.remove(
                  path.join(entriesDirectory, type, locale),
                  { recursive: true, force: true }
                );
              }
            }
          }
        }).pipe(
          Effect.mapError((cause) =>
            recipeError(
              "render",
              "Could not select the starter entry locales",
              cause
            )
          )
        );

        const recipesDirectory = path.join(directory, "recipes");
        const hasRecipes = yield* fileSystem
          .exists(recipesDirectory)
          .pipe(
            Effect.mapError((cause) =>
              recipeError(
                "render",
                "Could not inspect Contentstack block recipes",
                cause
              )
            )
          );
        if (hasRecipes) {
          const recipeFiles = yield* fileSystem
            .readDirectory(recipesDirectory)
            .pipe(
              Effect.mapError((cause) =>
                recipeError(
                  "render",
                  "Could not enumerate Contentstack block recipes",
                  cause
                )
              )
            );

          const recipeJsonFiles = recipeFiles.filter((file) =>
            file.endsWith(".json")
          );
          // eslint-disable-next-line unicorn/no-array-sort -- filter returns a fresh array.
          recipeJsonFiles.sort();
          for (const recipeFile of recipeJsonFiles) {
            const recipePath = path.join(recipesDirectory, recipeFile);
            const recipeSource = yield* fileSystem
              .readFileString(recipePath)
              .pipe(
                Effect.mapError((cause) =>
                  recipeError(
                    "render",
                    `Could not read Contentstack block recipe ${recipeFile}`,
                    cause
                  )
                )
              );
            const target = yield* Effect.try({
              catch: (cause) =>
                recipeError(
                  "render",
                  `Contentstack block recipe ${recipeFile} is invalid`,
                  cause
                ),
              try: () => blockRecipeTarget(recipeSource),
            });
            const contentTypePath = path.join(
              directory,
              "content_types",
              `${target.contentTypeUid}.json`
            );
            yield* Effect.gen(function* () {
              const contentType =
                yield* fileSystem.readFileString(contentTypePath);
              for (const locale of new Set([
                target.entryLocale,
                ...entryLocales,
              ])) {
                const entriesPath = path.join(
                  entriesDirectory,
                  target.entryContentType,
                  locale,
                  "1-entries.json"
                );
                if (
                  locale !== target.entryLocale &&
                  !(yield* fileSystem.exists(entriesPath))
                )
                  continue;
                const entries = yield* fileSystem.readFileString(entriesPath);
                const materialized = yield* Effect.try({
                  try: () =>
                    applyBlockRecipe({
                      contentType,
                      entries,
                      recipe: recipeSource,
                      locale,
                    }),
                  catch: (cause) =>
                    recipeError(
                      "render",
                      `Could not apply Contentstack block recipe ${target.id} for ${locale}`,
                      cause
                    ),
                });
                if (locale === target.entryLocale) {
                  yield* fileSystem.writeFileString(
                    contentTypePath,
                    materialized.contentType
                  );
                }
                yield* fileSystem.writeFileString(
                  entriesPath,
                  materialized.entries
                );
              }
            }).pipe(
              Effect.mapError((cause) =>
                recipeError(
                  "render",
                  `Could not materialize Contentstack block recipe ${target.id}`,
                  cause
                )
              )
            );
          }

          yield* fileSystem
            .remove(recipesDirectory, { recursive: true })
            .pipe(
              Effect.mapError((cause) =>
                recipeError(
                  "render",
                  "Could not remove materialized Contentstack block recipes",
                  cause
                )
              )
            );
        }

        const environmentsPath = path.join(
          directory,
          "environments",
          "environments.json"
        );
        const environments = yield* fileSystem
          .readFileString(environmentsPath)
          .pipe(
            Effect.mapError((cause) =>
              recipeError(
                "render",
                "Could not read the Contentstack environment recipe",
                cause
              )
            )
          );

        if (
          !environments.includes(LOCAL_URL_PLACEHOLDER) ||
          !environments.includes(PRODUCTION_URL_PLACEHOLDER)
        ) {
          return yield* recipeError(
            "render",
            "The Contentstack environment recipe is missing URL placeholders",
            new Error("Recipe URL placeholders were not found")
          );
        }

        const rendered = environments
          .replaceAll(LOCAL_URL_PLACEHOLDER, normalizedLocalUrl)
          .replaceAll(PRODUCTION_URL_PLACEHOLDER, normalizedProductionUrl);

        yield* fileSystem
          .writeFileString(environmentsPath, rendered)
          .pipe(
            Effect.mapError((cause) =>
              recipeError(
                "render",
                "Could not render Contentstack environment URLs",
                cause
              )
            )
          );

        const additionalLocales = new Map<string, string>();
        for (const locale of locales) {
          const code = locale.toLowerCase();
          if (code !== normalizedMasterLocale)
            additionalLocales.set(code, locale);
        }
        // The native starter content always includes English (US).
        if (normalizedMasterLocale !== "en-us")
          additionalLocales.set("en-us", "en-US");
        if (additionalLocales.size > 0) {
          const names = new Intl.DisplayNames(["en"], { type: "language" });
          const records = Object.fromEntries(
            [...additionalLocales].map(([code, tag]) => {
              const uid =
                code === "en-us"
                  ? "bltnexthydraenusa"
                  : `bltlocale${code.replaceAll("-", "")}`;
              return [
                uid,
                {
                  code,
                  fallback_locale: normalizedMasterLocale,
                  name: names.of(tag) ?? tag,
                  uid,
                },
              ];
            })
          );
          yield* fileSystem
            .writeFileString(
              path.join(directory, "locales", "locales.json"),
              `${JSON.stringify(records, null, 2)}\n`
            )
            .pipe(
              Effect.mapError((cause) =>
                recipeError(
                  "render",
                  "Could not render the configured Contentstack locales",
                  cause
                )
              )
            );
        }

        return new ContentstackRecipeReceipt({
          directory,
          environments: [...CONTENTSTACK_ENVIRONMENTS],
          version: CONTENTSTACK_RECIPE_VERSION,
        });
      }),
    });
  })
);
