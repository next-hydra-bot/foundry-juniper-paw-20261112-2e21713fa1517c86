import { CatalogRuntime } from "@repo/commerce-core/product/catalog-runtime";
import type {
  CategoryId,
  ProductId,
} from "@repo/commerce-core/product/identity";
import {
  ListProductCardsInput,
  ProductDiscovery,
} from "@repo/commerce-core/product/product-discovery";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";

import {
  ProductCollectionLayout,
  ProductGrid,
} from "@repo/design-system/components/commerce/blocks/product-collection";
import { ProductCardPrice } from "@repo/design-system/components/commerce/product-card";
import type { Locale } from "@repo/i18n/types";
import { Effect, Schema } from "effect";
import { Suspense, cache } from "react";
import type { ReactNode } from "react";

import { CommerceContextObservation } from "../commerce-context/commerce-context-observation";
import { CommerceLocale, resolveStore } from "../store";
import { getPublicProductCards } from "./catalog-reads";
import { toProductCardPresentation } from "./presentation";
import type { ProductCardPresentation } from "./presentation";

interface ProductCollectionProps {
  readonly categoryId?: CategoryId;
  readonly description?: ReactNode;
  readonly excludeProductId?: ProductId;
  readonly limit?: number;
  readonly locale: Locale;
  readonly title: string;
}

type ProductCollectionGridProps = Omit<
  ProductCollectionProps,
  "description" | "title"
>;

// All card price leaves in a collection share one request-time buyer/catalog read.
const getBuyerCards = cache(async (locale: Locale, encodedInput: string) => {
  const input = Schema.decodeSync(Schema.fromJsonString(ListProductCardsInput))(
    encodedInput
  );
  return await CatalogRuntime.run(
    locale,
    Effect.gen(function* () {
      const context = yield* CommerceContext;
      if (context.principal._tag === "AnonymousCommercePrincipal") {
        return null;
      }
      const discovery = yield* ProductDiscovery;
      return (yield* discovery.listCards(input)).map(toProductCardPresentation);
    })
  );
});

async function BuyerCardPrice({
  locale,
  input,
  product,
}: {
  readonly locale: Locale;
  readonly input: string;
  readonly product: ProductCardPresentation;
}) {
  const cards = await getBuyerCards(locale, input);
  const card =
    cards === null ? product : cards.find(({ id }) => id === product.id);
  return card === undefined ? null : <ProductCardPrice {...card} />;
}

const publicCards = async ({
  categoryId,
  excludeProductId,
  limit = 3,
  locale,
}: ProductCollectionGridProps) => {
  let input: typeof ListProductCardsInput.Encoded = { limit };
  if (categoryId !== undefined) {
    input = { ...input, categoryId };
  }
  if (excludeProductId !== undefined) {
    input = { ...input, excludeProductId };
  }
  const products = await getPublicProductCards(locale, input);
  return products.map(toProductCardPresentation).map((product) => ({
    ...product,
    priceContent: (
      <Suspense
        fallback={<div className="h-7 w-24 animate-pulse rounded bg-muted" />}
      >
        <BuyerCardPrice
          locale={locale}
          input={JSON.stringify(input)}
          product={product}
        />
      </Suspense>
    ),
  }));
};

export const ProductCollectionGrid = async (
  props: ProductCollectionGridProps
) => {
  const products = await publicCards(props);
  return products.length === 0 ? null : (
    <>
      <CommerceContextObservation
        store={resolveStore({ locale: CommerceLocale.make(props.locale) })}
      />
      <ProductGrid products={products} />
    </>
  );
};

export const ProductCollection = async ({
  description,
  title,
  ...props
}: ProductCollectionProps) => {
  const products = await publicCards(props);
  return products.length === 0 ? null : (
    <>
      <CommerceContextObservation
        store={resolveStore({ locale: CommerceLocale.make(props.locale) })}
      />
      <ProductCollectionLayout title={title} description={description}>
          <ProductGrid products={products} />
        </ProductCollectionLayout>
    </>
  );
};
