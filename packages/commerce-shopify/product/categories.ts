import { ProductCategoryDetail } from "@repo/commerce-core/product/category";
import type { CategorySlug } from "@repo/commerce-core/product/identity";
import { ProductDiscoveryFailure } from "@repo/commerce-core/product/product-discovery";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CommerceContext as CommerceContextService } from "@repo/commerce-core/services/commerce-context";
import { gql } from "@shopify/hydrogen";
import { Effect, Option, Schema } from "effect";

import { PageInfo } from "../client/schema";
import type { ShopifyStorefrontClient } from "../client/storefront";

export const categoryQuery =
  gql(`query CatalogCategory($handle:String!, $country:CountryCode!, $language:LanguageCode!) @inContext(country:$country, language:$language) {
  collection(handle:$handle) { id handle title description }
}`);
export const categoriesQuery =
  gql(`query CatalogCategories($after:String, $country:CountryCode!, $language:LanguageCode!) @inContext(country:$country, language:$language) {
  collections(first:100, after:$after, sortKey:TITLE) { nodes { id handle title description } pageInfo { hasNextPage endCursor } }
}`);
// The index uses the original handle as its stable category key. Translated handles
// are URLs, so fetch keys in the shop's default language rather than guessing them.
export const categoryKeysQuery =
  gql(`query CatalogCategoryKeys($ids:[ID!]!, $country:CountryCode!) @inContext(country:$country, language:null) {
  nodes(ids:$ids) { ... on Collection { id handle } }
}`);

const Collection = Schema.Struct({
  description: Schema.String,
  handle: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});
const CategoryResponse = Schema.Struct({
  collection: Schema.NullOr(Collection),
});
const CategoriesResponse = Schema.Struct({
  collections: Schema.Struct({
    nodes: Schema.Array(Collection),
    pageInfo: PageInfo,
  }),
});
const KeysResponse = Schema.Struct({
  nodes: Schema.Array(
    Schema.NullOr(
      Schema.Struct({
        handle: Schema.NonEmptyString,
        id: Schema.String,
      })
    )
  ),
});

export const categoryDiscoveryMethods = (
  client: ShopifyStorefrontClient["Service"],
  context: CommerceContext["Service"]
) => {
  const localize = Effect.fn("Shopify.localizeCategories")(function* (
    collections: readonly (typeof Collection.Type)[]
  ) {
    if (collections.length === 0) {
      return [];
    }
    const data = yield* client
      .execute(
        async (sdk, signal) =>
          await sdk.graphql(categoryKeysQuery, {
            signal,
            variables: { ids: collections.map(({ id }) => id) },
          })
      )
      .pipe(Effect.provideService(CommerceContextService, context));
    const { nodes } = yield* Schema.decodeUnknownEffect(KeysResponse)(data);
    const keys = new Map(
      nodes.flatMap((node) =>
        node === null ? [] : [[node.id, node.handle] as const]
      )
    );
    return yield* Effect.forEach((collection: typeof Collection.Type) =>
      Schema.decodeUnknownEffect(ProductCategoryDetail)({
        description: collection.description,
        id: collection.id,
        key: keys.get(collection.id),
        name: collection.title,
        slug: collection.handle,
      })
    )(collections);
  });
  return {
    findCategoryBySlug: Effect.fn("Shopify.findCategoryBySlug")(
      function* (slug: CategorySlug) {
        const data = yield* client
          .execute(
            async (sdk, signal) =>
              await sdk.graphql(categoryQuery, {
                signal,
                variables: { handle: slug },
              })
          )
          .pipe(Effect.provideService(CommerceContextService, context));
        const { collection } =
          yield* Schema.decodeEffect(CategoryResponse)(data);
        if (collection === null) {
          return Option.none<ProductCategoryDetail>();
        }
        const categories = yield* localize([collection]);
        return Option.fromUndefinedOr(categories[0]);
      },
      Effect.mapError(
        (cause) =>
          new ProductDiscoveryFailure({
            cause,
            message: "Shopify category lookup failed",
            operation: "findCategoryBySlug",
          })
      )
    ),
    listCategories: Effect.fn("Shopify.listCategories")(
      function* () {
        const categories: ProductCategoryDetail[] = [];
        let after: string | undefined;
        const cursors = new Set<string>();
        while (true) {
          const cursor = after;
          const data = yield* client
            .execute(
              async (sdk, signal) =>
                await sdk.graphql(categoriesQuery, {
                  signal,
                  variables: { after: cursor },
                })
            )
            .pipe(Effect.provideService(CommerceContextService, context));
          const { collections } =
            yield* Schema.decodeEffect(CategoriesResponse)(data);
          categories.push(...(yield* localize(collections.nodes)));
          if (!collections.pageInfo.hasNextPage) {
            return categories;
          }
          const next = collections.pageInfo.endCursor;
          if (!next || cursors.has(next)) {
            return yield* new ProductDiscoveryFailure({
              message: "Shopify returned an invalid category cursor",
              operation: "listCategories",
            });
          }
          cursors.add(next);
          after = next;
        }
      },
      Effect.mapError(
        (cause) =>
          new ProductDiscoveryFailure({
            cause,
            message: "Shopify category listing failed",
            operation: "listCategories",
          })
      )
    ),
  };
};
