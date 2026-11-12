import { CommerceSearchIndexingFailure } from "@repo/commerce-core/search-indexing";
import { Effect, Schema } from "effect";

import type { CatalogAdmin } from "../catalog/admin";
import { shopifyLocale } from "../catalog/mapping";

const CollectionPage = Schema.Struct({
  collections: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        handle: Schema.NonEmptyString,
        legacyResourceId: Schema.String.check(Schema.isPattern(/^\d+$/u)),
        title: Schema.NonEmptyString,
        translations: Schema.Array(
          Schema.Struct({ key: Schema.String, value: Schema.String })
        ),
      })
    ),
    pageInfo: Schema.Struct({
      endCursor: Schema.NullOr(Schema.String),
      hasNextPage: Schema.Boolean,
    }),
  }),
});

/** Snapshot native titles once per language, joined to product memberships by collection ID. */
export const loadSearchCategories = Effect.fn("ShopifySearch.categories")(
  function* (admin: CatalogAdmin, locales: readonly string[]) {
    const data = yield* admin.request(
      "SearchCollectionLocales",
      "query SearchCollectionLocales { shopLocales { locale published } }"
    );
    const { shopLocales } = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        shopLocales: Schema.Array(
          Schema.Struct({ locale: Schema.String, published: Schema.Boolean })
        ),
      })
    )(data);
    const available = shopLocales
      .filter(({ published }) => published)
      .map(({ locale }) => locale);
    const snapshots = new Map<
      string,
      readonly { id: string; key: string; label: string }[]
    >();
    const result = new Map<
      string,
      readonly { id: string; key: string; label: string }[]
    >();
    for (const locale of new Set(locales)) {
      const nativeLocale = yield* Effect.try({
        catch: (cause) =>
          new CommerceSearchIndexingFailure({
            cause,
            message: `Enable and publish the Shopify locale for ${locale} before provisioning search`,
            operation: "resolveIndexingContext",
          }),
        try: () => shopifyLocale(locale, available),
      });
      let categories = snapshots.get(nativeLocale);
      if (categories === undefined) {
        const entries: { id: string; key: string; label: string }[] = [];
        let after: string | null = null;
        const cursors = new Set<string>();
        while (true) {
          const page: Record<string, Schema.Json> = yield* admin.request(
            "SearchCollections",
            "query SearchCollections($locale:String!, $after:String) { collections(first:100, after:$after) { nodes { legacyResourceId handle title translations(locale:$locale) { key value } } pageInfo { hasNextPage endCursor } } }",
            { after, locale: nativeLocale }
          );
          const { collections } =
            yield* Schema.decodeUnknownEffect(CollectionPage)(page);
          entries.push(
            ...collections.nodes.map((collection) => ({
              id: collection.legacyResourceId,
              key: collection.handle,
              label:
                collection.translations.find(
                  ({ key, value }) => key === "title" && value.length > 0
                )?.value ?? collection.title,
            }))
          );
          if (!collections.pageInfo.hasNextPage) {
            break;
          }
          const cursor = collections.pageInfo.endCursor;
          if (!cursor || cursors.has(cursor)) {
            return yield* new CommerceSearchIndexingFailure({
              message: "Shopify returned an invalid collection cursor",
              operation: "resolveIndexingContext",
            });
          }
          cursors.add(cursor);
          after = cursor;
        }
        categories = entries;
        snapshots.set(nativeLocale, categories);
      }
      result.set(locale, categories);
    }
    return result;
  }
);
