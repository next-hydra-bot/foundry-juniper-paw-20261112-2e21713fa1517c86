import { createHash } from "node:crypto";

import { makeJsonMigration } from "@repo/cli-core/json-migrations";
import type { ProvisionedResource } from "@repo/cli-core/json-migrations";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import {
  DestinationError,
  MigrationDefinitionRegistry,
  MigrationReferenceLookup,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationStore,
  MigrationStoreError,
} from "migrate-sdk";

import type { CommerceContentMigrations } from "./commerce";
import {
  ContentResource,
  ContentAsset,
  ContentArticle,
  ContentPage,
  ContentNavigation,
  ContentAnnouncement,
} from "./model";
import type { ContentProfile, ContentDependencies } from "./model";
import { entryIdentity } from "./profile";

/** Private provider operations, not migration source records. */
export interface ContentTask {
  readonly key: string;
  readonly phase:
    | "assets"
    | "content"
    | "navigation"
    | "announcements"
    | "publication";
  readonly sourceKey: string;
  readonly locale?: string;
}
export interface ContentDestination {
  readonly target: string;
  readonly publicationTarget?: string;
  readonly write: (
    task: ContentTask,
    profile: ContentProfile,
    previous?: ProvisionedResource,
    dependencies?: ContentDependencies
  ) => Effect.Effect<ContentResource, DestinationError>;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nativeId = (
  definition: AnySelfContainedMigrationDefinition,
  key: string
) =>
  Effect.gen(function* () {
    const lookup = yield* MigrationReferenceLookup;
    const result = yield* lookup
      .lookup({ definition, sourceIdentityKey: key })
      .pipe(
        Effect.mapError(
          () =>
            new DestinationError({
              message: `Cannot read migrated dependency ${definition.id}: ${key}`,
            })
        )
      );
    if (result?.status !== "migrated") {
      return yield* new DestinationError({
        message: `Dependency has not migrated: ${definition.id}/${key}`,
      });
    }
    return (yield* Schema.decodeUnknownEffect(
      Schema.Struct({ id: Schema.NonEmptyString })
    )(result.trackingRecord).pipe(
      Effect.mapError(
        () =>
          new DestinationError({
            message: `Invalid migrated identity: ${definition.id}/${key}`,
          })
      )
    )).id;
  });
export const contentMigrationNames = [
  "assets",
  "articles",
  "pages",
  "navigation",
  "announcements",
  "article-publications",
  "page-publications",
] as const;

/** Each source is an entity collection; SDK dependencies resolve native identities. */
export const makeContentRegistry = (
  profile: ContentProfile,
  destination: ContentDestination,
  store: Layer.Layer<MigrationStore, MigrationStoreError>,
  assetVersions: Readonly<Record<string, string>>,
  commerce?: CommerceContentMigrations
) =>
  Effect.gen(function* () {
    // Corrections reapply the profile through the same tracked native identities.
    const revision = `cms-content-v4:${hash(profile)}`;
    const prefix = `${profile.model.key}-cms-${hash(destination.target).slice(0, 10)}-`;
    const projectStore = commerce?.store ?? store;
    const operation = (
      phase: ContentTask["phase"],
      key: string,
      sourceKey: string,
      locale?: string
    ): ContentTask => ({
      key,
      phase,
      sourceKey,
      ...(locale ? { locale } : {}),
    });
    const AssetSource = Schema.Struct({
      ...ContentAsset.fields,
      sourceVersion: Schema.String,
    });
    const assets = yield* makeJsonMigration({
      destination: {
        entity: ContentResource,
        reference: (resource) => resource,
        write: (asset, _lookup, previous) =>
          destination.write(
            operation("assets", asset.key, asset.key),
            profile,
            previous
          ),
      },
      group: "cms-content",
      id: `${prefix}assets`,
      input: {
        items: profile.assets.map((asset) => ({
          ...asset,
          sourceVersion: assetVersions[asset.key] ?? asset.source,
        })),
        key: (asset) => asset.key,
        schema: AssetSource,
      },
      revision: `${revision}:${destination.publicationTarget ?? ""}`,
      store: projectStore,
    });
    const resolveAssets = (keys: readonly string[]) =>
      Effect.gen(function* () {
        const rows = yield* Effect.forEach([...new Set(keys)], (key) =>
          nativeId(assets, key).pipe(Effect.map((id) => [key, id] as const))
        );
        return Object.fromEntries(rows);
      });
    const orderedEntries = [...profile.entries].sort(
      (a, b) =>
        Number(b.locale === profile.model.defaultLocale) -
        Number(a.locale === profile.model.defaultLocale)
    );
    const articles: AnySelfContainedMigrationDefinition =
      yield* makeJsonMigration({
        dependencies: [assets],
        destination: {
          entity: ContentResource,
          reference: (resource) => resource,
          write: (article, _lookup, previous) =>
            Effect.gen(function* () {
              const imageIds = yield* resolveAssets(
                article.imageKey ? [article.imageKey] : []
              );
              const entryId =
                article.locale === profile.model.defaultLocale
                  ? undefined
                  : yield* nativeId(
                      articles,
                      entryIdentity(article.key, profile.model.defaultLocale)
                    );
              return yield* destination.write(
                operation(
                  "content",
                  entryIdentity(article.key, article.locale),
                  article.key,
                  article.locale
                ),
                profile,
                previous,
                { assets: imageIds, categories: {}, entry: entryId }
              );
            }),
        },
        group: "cms-content",
        id: `${prefix}articles`,
        input: {
          items: orderedEntries.filter(
            (entry): entry is typeof ContentArticle.Type =>
              entry.type === "article"
          ),
          key: (entry) => entryIdentity(entry.key, entry.locale),
          schema: ContentArticle,
        },
        revision,
        store: projectStore,
      });
    const pages: AnySelfContainedMigrationDefinition = yield* makeJsonMigration(
      {
        dependencies: [
          assets,
          articles,
          ...(commerce ? [commerce.categories] : []),
        ],
        destination: {
          entity: ContentResource,
          reference: (resource) => resource,
          write: (page, _lookup, previous) =>
            Effect.gen(function* () {
              const imageIds = yield* resolveAssets(
                page.blocks.flatMap((block) =>
                  block.type === "hero" && block.imageKey
                    ? [block.imageKey]
                    : []
                )
              );
              const categoryIds: Record<string, string> = {};
              for (const block of page.blocks) {
                if (block.type === "product-collection") {
                  if (!commerce) {
                    return yield* new DestinationError({
                      message:
                        "Supply the commerce source directory for category migration dependencies.",
                    });
                  }
                  categoryIds[block.categoryKey] = yield* nativeId(
                    commerce.categories,
                    block.categoryKey
                  );
                }
              }
              const entryId =
                page.locale === profile.model.defaultLocale
                  ? undefined
                  : yield* nativeId(
                      pages,
                      entryIdentity(page.key, profile.model.defaultLocale)
                    );
              return yield* destination.write(
                operation(
                  "content",
                  entryIdentity(page.key, page.locale),
                  page.key,
                  page.locale
                ),
                profile,
                previous,
                { assets: imageIds, categories: categoryIds, entry: entryId }
              );
            }),
        },
        group: "cms-content",
        id: `${prefix}pages`,
        input: {
          items: orderedEntries.filter(
            (entry): entry is typeof ContentPage.Type => entry.type === "page"
          ),
          key: (entry) => entryIdentity(entry.key, entry.locale),
          schema: ContentPage,
        },
        revision,
        store: projectStore,
      }
    );
    const menus = [...profile.navigation].sort(
      (a, b) =>
        Number(b.locale === profile.model.defaultLocale) -
        Number(a.locale === profile.model.defaultLocale)
    );
    const navigation = yield* makeJsonMigration({
      dependencies: [articles, pages],
      destination: {
        entity: ContentResource,
        reference: (resource) => resource,
        write: (menu, _lookup, previous) =>
          destination.write(
            operation(
              "navigation",
              entryIdentity(menu.key, menu.locale),
              menu.key,
              menu.locale
            ),
            profile,
            previous
          ),
      },
      group: "cms-content",
      id: `${prefix}navigation`,
      input: {
        items: menus,
        key: (menu) => entryIdentity(menu.key, menu.locale),
        schema: ContentNavigation,
      },
      revision: `${revision}:${destination.publicationTarget ?? ""}`,
      store: projectStore,
    });
    const announcements = yield* makeJsonMigration({
      dependencies: [articles, pages],
      destination: {
        entity: ContentResource,
        reference: (resource) => resource,
        write: (item, _lookup, previous) =>
          destination.write(
            operation(
              "announcements",
              entryIdentity(item.key, item.locale),
              item.key,
              item.locale
            ),
            profile,
            previous
          ),
      },
      group: "cms-content",
      id: `${prefix}announcements`,
      input: {
        items: [...profile.announcements].sort(
          (a, b) =>
            Number(b.locale === profile.model.defaultLocale) -
            Number(a.locale === profile.model.defaultLocale)
        ),
        key: (item) => entryIdentity(item.key, item.locale),
        schema: ContentAnnouncement,
      },
      revision: `${revision}:${destination.publicationTarget ?? ""}`,
      store: projectStore,
    });
    const Publication = Schema.Struct({
      key: Schema.NonEmptyString,
      locale: Schema.String,
      published: Schema.Boolean,
      sourceKey: Schema.String,
    });
    const publications = [];
    for (const [kind, definition] of [
      ["article", articles],
      ["page", pages],
    ] as const) {
      const publication = yield* makeJsonMigration({
        dependencies: [definition, navigation, announcements],
        destination: {
          entity: ContentResource,
          reference: (resource) => resource,
          write: (item, _lookup, previous) =>
            Effect.gen(function* () {
              const entry = yield* nativeId(
                definition,
                entryIdentity(item.sourceKey, item.locale)
              );
              return yield* destination.write(
                operation("publication", item.key, item.sourceKey, item.locale),
                profile,
                previous,
                { assets: {}, categories: {}, entry }
              );
            }),
        },
        group: "cms-content",
        id: `${prefix + kind}-publications`,
        input: {
          items: orderedEntries
            .filter((entry) => entry.type === kind)
            .map((entry) => ({
              key: `${entryIdentity(entry.key, entry.locale)}@${
                destination.publicationTarget ?? "site"
              }`,
              locale: entry.locale,
              published: entry.published,
              sourceKey: entry.key,
            })),
          key: (item) => item.key,
          schema: Publication,
        },
        revision,
        store: projectStore,
      });
      publications.push(publication);
    }
    return MigrationDefinitionRegistry.make({
      definitions: [
        ...(commerce?.definitions ?? []),
        assets,
        articles,
        pages,
        navigation,
        announcements,
        ...publications,
      ],
    });
  });
