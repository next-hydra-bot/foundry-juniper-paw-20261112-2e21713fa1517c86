import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { ContentstackRecipe } from "./recipe";
import { contentstackRecipeLayer } from "./recipe-live";

const LedgerContentType = Schema.Struct({
  schema: Schema.Array(Schema.Struct({ uid: Schema.NonEmptyString })),
  uid: Schema.Literal("migrations"),
});

describe(ContentstackRecipe, () => {
  it.effect("materializes a scoped recipe with the requested URLs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recipe = yield* ContentstackRecipe;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const receipt = yield* recipe.materialize({
          localUrl: "https://web.juniper-paw-20261112.localhost/",
          productionUrl: "https://store.example.com/",
          targetMasterLocale: "en-us",
        });
        const environments = yield* fileSystem.readFileString(
          path.join(receipt.directory, "environments", "environments.json")
        );
        const locales = yield* fileSystem.readFileString(
          path.join(receipt.directory, "locales", "locales.json")
        );
        expect(environments).toContain("https://web.juniper-paw-20261112.localhost");
        expect(environments).toContain("https://store.example.com");
        expect(environments).not.toContain("__NEXT_HYDRA_");
        expect(locales).toBe("{}\n");
        expect(
          yield* fileSystem.exists(
            path.join(receipt.directory, "entries", "landing_page", "fr-ca")
          )
        ).toBe(false);
        expect(receipt.environments).toStrictEqual([
          "development",
          "production",
        ]);
      }).pipe(
        Effect.provide(
          contentstackRecipeLayer.pipe(Layer.provideMerge(NodeServices.layer))
        )
      )
    )
  );

  it.effect(
    "imports active Canadian locales and renders localized optional blocks",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const recipe = yield* ContentstackRecipe;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const receipt = yield* recipe.materialize({
            localUrl: "https://demo.localhost",
            productionUrl: "https://store.example.com",
            targetMasterLocale: "en-us",
            locales: ["en-US", "en-CA", "fr-CA"],
          });
          const entries = (locale: string) =>
            fs.readFileString(
              path.join(
                receipt.directory,
                "entries",
                "landing_page",
                locale,
                "1-entries.json"
              )
            );
          const english = yield* entries("en-ca");
          const french = yield* entries("fr-ca");
          expect(english).toContain("Heavy machinery for every job");
          expect(french).toContain(
            "De la machinerie lourde pour tous vos travaux"
          );
          if (english.includes("dynamic_product_collection")) {
            expect(french).toContain("Équipement en vedette");
          }
          expect(french).toContain('"locale": "fr-ca"');
        }).pipe(
          Effect.provide(
            contentstackRecipeLayer.pipe(Layer.provideMerge(NodeServices.layer))
          )
        )
      )
  );

  it.effect("includes the migration ledger in the baseline recipe", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recipe = yield* ContentstackRecipe;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const receipt = yield* recipe.materialize({
          localUrl: "https://web.juniper-paw-20261112.localhost",
          productionUrl: "https://store.example.com",
          targetMasterLocale: "en-us",
        });
        const ledgerContentType = yield* fileSystem
          .readFileString(
            path.join(receipt.directory, "content_types", "migrations.json")
          )
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(LedgerContentType)
              )
            )
          );

        expect(
          ledgerContentType.schema.map((field) => field.uid)
        ).toStrictEqual([
          "title",
          "migration_key",
          "applied_at",
          "applied_by",
          "version",
        ]);
        expect(receipt.version).toBe("4");
      }).pipe(
        Effect.provide(
          contentstackRecipeLayer.pipe(Layer.provideMerge(NodeServices.layer))
        )
      )
    )
  );

  it.effect("keeps English entries importable for another master locale", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recipe = yield* ContentstackRecipe;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const receipt = yield* recipe.materialize({
          localUrl: "https://web.juniper-paw-20261112.localhost",
          productionUrl: "https://store.example.com",
          targetMasterLocale: "fr-fr",
        });
        const locales = yield* fileSystem.readFileString(
          path.join(receipt.directory, "locales", "locales.json")
        );

        expect(locales).toContain('"code": "en-us"');
      }).pipe(
        Effect.provide(
          contentstackRecipeLayer.pipe(Layer.provideMerge(NodeServices.layer))
        )
      )
    )
  );
});
