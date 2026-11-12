import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import { Effect } from "effect";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";
import { describe, expect, it } from "vitest";

import { defaultContent } from "./default-content";
import { makeContentRegistry } from "./migrations";
import { installedContentModel } from "./model";

describe("CMS Migrate execution", () => {
  it("resumes unchanged content and publishes independently to another environment", async () => {
    const profile = defaultContent({
      ...installedContentModel(false),
      defaultLocale: "en-US",
      locales: ["en-US"],
    });
    const store = InMemoryMigrationStore.layer();
    const publications: string[] = [];
    const run = async (environment: string) => {
      await Effect.gen(function* () {
        const registry = yield* makeContentRegistry(
          profile,
          {
            publicationTarget: environment,
            target: "test-stack:main",
            write: (task) =>
              Effect.sync(() => {
                if (task.phase === "publication") {
                  publications.push(`${environment}:${task.sourceKey}`);
                }
                return { id: task.sourceKey, key: task.key };
              }),
          },
          store,
          {}
        );
        yield* provisionMigrationGroup(registry, "cms-content");
      }).pipe(Effect.runPromise);
    };
    await run("development");
    expect([...publications].sort()).toEqual([
      "development:home",
      "development:maintenance-guide",
    ]);
    await run("development");
    expect(publications).toHaveLength(2);
    await run("production");
    expect(publications.slice(2).sort()).toEqual([
      "production:home",
      "production:maintenance-guide",
    ]);
  });
});

it("pages resolve assets and the existing category migration's tracking in the shared project store", async () => {
  const { Schema } = await import("effect");
  const {
    MigrationDefinition,
    MigrationDefinitionRegistry,
    MigrationExecution,
    Tracking,
  } = await import("migrate-sdk");
  const { documentRows } = await import("@repo/cli-core/json-migrations");
  const categoryStore = InMemoryMigrationStore.layer();
  const cmsStore = InMemoryMigrationStore.layer();
  let categoryWrites = 0;
  const categorySchema = Schema.Struct({ key: Schema.String });
  const categories = MigrationDefinition.make({
    group: "wholesale",
    id: "wholesale-categories",
    process: () =>
      Effect.gen(function* () {
        categoryWrites++;
        yield* Tracking.setRecord({ id: "category-from-original-store" });
      }),
    source: documentRows(
      categorySchema,
      Effect.succeed([{ item: { key: "drinks" }, key: "drinks" }])
    ),
    store: categoryStore,
    tracking: Tracking.record({
      id: "native-category@v1",
      schema: Schema.Struct({ id: Schema.String }),
    }),
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* MigrationExecution.make({
          registry: MigrationDefinitionRegistry.make({
            definitions: [categories],
          }),
        }).run({ group: "wholesale", withDependencies: true });
        if (started.kind !== "completed" && started.handle) {
          yield* started.handle.wait;
        }
      })
    )
  );

  const base = defaultContent({
    ...installedContentModel(true),
    defaultLocale: "en-US",
    locales: ["en-US"],
  });
  const profile = {
    ...base,
    assets: [
      {
        alt: { "en-US": "A beverage case" },
        key: "hero-image",
        source: "image.png",
      },
    ],
    entries: base.entries.map((entry) =>
      entry.type === "page"
        ? {
            ...entry,
            blocks: [
              {
                imageKey: "hero-image",
                key: "hero",
                title: "Beverages",
                type: "hero" as const,
              },
              {
                categoryKey: "drinks",
                key: "drinks",
                limit: 3 as const,
                title: "Drinks",
                type: "product-collection" as const,
              },
            ],
          }
        : entry
    ),
  };
  let resolved: unknown;
  await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* makeContentRegistry(
        profile,
        {
          target: "cms-site",
          write: (task, _profile, _previous, dependencies) =>
            Effect.sync(() => {
              if (task.phase === "content" && task.sourceKey === "home") {
                resolved = dependencies;
              }
              return {
                id:
                  task.phase === "assets"
                    ? "asset-from-sdk-store"
                    : task.sourceKey,
                key: task.key,
              };
            }),
        },
        cmsStore,
        { "hero-image": "image-version" },
        {
          categories,
          definitions: [categories],
          store: categoryStore,
          target: "commerce-target",
        }
      );
      yield* provisionMigrationGroup(registry, "cms-content");
    })
  );
  expect(categoryWrites).toBe(1);
  expect(resolved).toEqual({
    assets: { "hero-image": "asset-from-sdk-store" },
    categories: { drinks: "category-from-original-store" },
  });
});

it("refreshes rendered links when a referenced entry route changes", async () => {
  const { linkPath } = await import("./profile");
  const store = InMemoryMigrationStore.layer();
  const menus: string[] = [];
  const run = async (profile: ReturnType<typeof defaultContent>) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeContentRegistry(
          profile,
          {
            target: "site-with-links",
            write: (task, current) =>
              Effect.sync(() => {
                if (task.phase === "navigation") {
                  const menu = current.navigation.find(
                    (row) => row.locale === task.locale
                  )!;
                  menus.push(
                    linkPath(current, menu.items[1]!.link, task.locale!)
                  );
                }
                return { id: task.sourceKey, key: task.key };
              }),
          },
          store,
          {}
        );
        yield* provisionMigrationGroup(registry, "cms-content");
      })
    );
  };
  const profile = defaultContent({
    ...installedContentModel(false),
    defaultLocale: "en-US",
    locales: ["en-US"],
  });
  await run(profile);
  const changed = {
    ...profile,
    entries: profile.entries.map((entry) =>
      entry.type === "article" ? { ...entry, path: "/new-guide" } : entry
    ),
  };
  await run(changed);
  await run(changed);
  expect(menus).toEqual([
    "/resources/preventive-maintenance-checklist",
    "/new-guide",
  ]);
});

it("reuses tracked native identities when retrying a failed first translation", async () => {
  const { DestinationError } = await import("migrate-sdk");
  const profile = defaultContent({
    ...installedContentModel(false),
    locales: ["en-US", "de-DE"],
  });
  const store = InMemoryMigrationStore.layer();
  const baseWrites: string[] = [];
  const translatedBindings: string[] = [];
  const publicationBindings: string[] = [];
  let failTranslation = true;
  const run = async () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* makeContentRegistry(
          profile,
          {
            target: "adopted-native-site",
            write: (task, _profile, _previous, dependencies) =>
              Effect.gen(function* () {
                const id = "native:" + task.sourceKey;
                if (task.phase === "content") {
                  if (task.locale === "de-DE") {
                    if (dependencies?.entry !== id)
                      return yield* new DestinationError({
                        message: "Translation lost its adopted base identity",
                      });
                    translatedBindings.push(dependencies.entry);
                    if (failTranslation)
                      return yield* new DestinationError({
                        message: "Temporary native write failure",
                      });
                  } else baseWrites.push(task.sourceKey);
                }
                if (task.phase === "publication") {
                  if (dependencies?.entry !== id)
                    return yield* new DestinationError({
                      message: "Publication lost its content identity",
                    });
                  publicationBindings.push(dependencies.entry);
                }
                return { id, key: task.key };
              }),
          },
          store,
          {}
        );
        yield* provisionMigrationGroup(registry, "cms-content");
      })
    );
  await expect(run()).rejects.toThrow();
  failTranslation = false;
  await run();
  expect(baseWrites.sort()).toEqual(["home", "maintenance-guide"]);
  expect(translatedBindings).toContain("native:maintenance-guide");
  expect(publicationBindings.sort()).toEqual([
    "native:home",
    "native:home",
    "native:maintenance-guide",
    "native:maintenance-guide",
  ]);
});
