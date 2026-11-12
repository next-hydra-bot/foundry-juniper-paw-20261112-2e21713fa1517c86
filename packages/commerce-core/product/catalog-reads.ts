import "server-only";
import { PublicCatalog } from "@repo/commerce-core/product/public-catalog";
import type { Locale } from "@repo/i18n/types";
import { Effect, Option, Schema } from "effect";
import { cacheLife, cacheTag } from "next/cache";

import { CommerceLocale, resolveStore } from "../store";
import { catalogTags } from "./cache-tags";
import { CategorySlug, ProductSlug } from "./identity";
import { ListProductCardsInput, ProductDiscovery } from "./product-discovery";

// Next generates one overload per cache profile, so select literal names here.
const cacheProductRead = () => {
  if (PublicCatalog.productCacheLife === "hours") {
    cacheLife("hours");
  } else {
    cacheLife("max");
  }
};

export async function getPublicProduct(locale: Locale, slug: string) {
  "use cache: remote";
  cacheTag(catalogTags.products);
  const productSlug = Schema.decodeSync(ProductSlug)(slug);
  const result = await PublicCatalog.run(
    resolveStore({ locale: CommerceLocale.make(locale) }),
    Effect.gen(function* () {
      const discovery = yield* ProductDiscovery;
      return yield* discovery.findBySlug(productSlug);
    })
  );
  if (Option.isNone(result)) {
    cacheLife("minutes");
    cacheTag(catalogTags.productLookups);
    return null;
  }
  cacheProductRead();
  cacheTag(catalogTags.product(result.value.id));
  return result.value;
}

export async function getPublicProductCards(
  locale: Locale,
  input: typeof ListProductCardsInput.Encoded
) {
  "use cache: remote";
  cacheProductRead();
  cacheTag(catalogTags.products, catalogTags.productLists);
  const listInput = Schema.decodeSync(ListProductCardsInput)(input);
  const products = await PublicCatalog.run(
    resolveStore({ locale: CommerceLocale.make(locale) }),
    Effect.gen(function* () {
      const discovery = yield* ProductDiscovery;
      return yield* discovery.listCards(listInput);
    })
  );
  for (const product of products) {
    cacheTag(catalogTags.product(product.id));
  }
  return products;
}

export async function getPublicCategory(locale: Locale, slug: string) {
  "use cache: remote";
  cacheLife("max");
  cacheTag(catalogTags.categories);
  const categorySlug = Schema.decodeSync(CategorySlug)(slug);
  return await PublicCatalog.run(
    resolveStore({ locale: CommerceLocale.make(locale) }),
    Effect.gen(function* () {
      const discovery = yield* ProductDiscovery;
      const category = yield* discovery.findCategoryBySlug(categorySlug);
      return Option.getOrNull(category);
    })
  );
}

export async function getPublicCategories(locale: Locale) {
  "use cache: remote";
  cacheLife("max");
  cacheTag(catalogTags.categories);
  return await PublicCatalog.run(
    resolveStore({ locale: CommerceLocale.make(locale) }),
    Effect.gen(function* () {
      const discovery = yield* ProductDiscovery;
      return yield* discovery.listCategories();
    })
  );
}
