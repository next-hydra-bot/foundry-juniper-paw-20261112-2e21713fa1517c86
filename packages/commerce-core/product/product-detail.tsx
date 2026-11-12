import { ProductSlug } from "@repo/commerce-core/product/identity";
import { ProductDiscovery } from "@repo/commerce-core/product/product-discovery";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";

import {
  ProductDetail,
  ProductDetailHeading,
  ProductDetailLayout,
  ProductDetailMedia,
  ProductDetailPurchase,
} from "@repo/design-system/components/commerce/blocks/product-detail";
import type { Locale } from "@repo/i18n/types";
import { Effect, Option, Schema } from "effect";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";

import { CommerceContextObservation } from "../commerce-context/commerce-context-observation";
import { CommerceLocale, resolveStore } from "../store";
import { getPublicProduct } from "./catalog-reads";
import { CatalogRuntime } from "./catalog-runtime";
import {
  toProductDetailMetadata,
  toProductDetailPresentation,
  toProductJsonLd,
} from "./presentation";
import type { ProductDetailPresentation } from "./presentation";
import {
  CommerceProductMedia,
  CommerceProductPurchase,
  CommerceProductSelection,
} from "./product-detail-client";
import { ProductDetailExtensions } from "./product-detail-extensions";

interface ProductDetailBoundaryProps {
  readonly locale: Locale;
  readonly slug: string;
  readonly searchParams?: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}

const loadBuyerProduct = cache(async (locale: Locale, slug: string) => {
  const productSlug = Schema.decodeSync(ProductSlug)(slug);
  return await CatalogRuntime.run(
    locale,
    Effect.gen(function* () {
      const context = yield* CommerceContext;
      if (context.principal._tag === "AnonymousCommercePrincipal") {
        return null;
      }
      const discovery = yield* ProductDiscovery;
      return yield* discovery.findBySlug(productSlug);
    })
  );
});

function PurchaseSkeleton() {
  return <div className="h-[32rem] animate-pulse rounded-lg bg-muted" />;
}

async function BuyerPurchase({
  locale,
  slug,
  product,
}: {
  readonly locale: Locale;
  readonly slug: string;
  readonly product: ProductDetailPresentation;
}) {
  const buyerProduct = await loadBuyerProduct(locale, slug);
  if (buyerProduct === null) {
    return <CommerceProductPurchase {...product} />;
  }
  if (Option.isNone(buyerProduct)) {
    return (
      <CommerceProductPurchase
        {...product}
        availableForSale={false}
        variants={product.variants.map((variant) => ({
          ...variant,
          isInStock: false,
          price: undefined,
          salePrice: undefined,
        }))}
      />
    );
  }
  return (
    <CommerceProductPurchase
      {...toProductDetailPresentation(buyerProduct.value)}
    />
  );
}

async function SelectedProduct({
  product,
  ...props
}: ProductDetailBoundaryProps & {
  readonly product: NonNullable<Awaited<ReturnType<typeof getPublicProduct>>>;
}) {
  const query = await props.searchParams;
  // Resolve URL selection on the server; buyer lookups cannot delay the media.
  const selected = toProductDetailPresentation(product, query);
  return (
    <CommerceProductSelection product={selected}>
      <ProductDetailMedia>
        <CommerceProductMedia product={selected} />
      </ProductDetailMedia>
      <ProductDetailPurchase>
        <Suspense fallback={<PurchaseSkeleton />}>
          <BuyerPurchase
            locale={props.locale}
            slug={props.slug}
            product={selected}
          />
        </Suspense>
        <Suspense fallback={null}>
          <ProductDetailExtensions locale={props.locale} product={selected} />
        </Suspense>
      </ProductDetailPurchase>
    </CommerceProductSelection>
  );
}

export async function generateMetadataHandler(
  props: ProductDetailBoundaryProps
): Promise<Metadata> {
  const product = await getPublicProduct(props.locale, props.slug);
  if (product === null) {
    return notFound();
  }
  return toProductDetailMetadata(product);
}

export async function ProductDetailPage(props: ProductDetailBoundaryProps) {
  const product = await getPublicProduct(props.locale, props.slug);
  if (product === null) {
    return notFound();
  }
  const presentation = toProductDetailPresentation(product);
  return (
    <>
      <CommerceContextObservation
        store={resolveStore({ locale: CommerceLocale.make(props.locale) })}
      />
      <ProductDetail
          categoryName={presentation.categoryName}
          title={presentation.title}
        >
          <script
            type="application/ld+json"
            // oxlint-disable-next-line react/no-danger -- JSON-LD requires a script body.
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(toProductJsonLd(product)),
            }}
          />
          <ProductDetailLayout
            heading={
              <ProductDetailHeading
                title={presentation.title}
                description={presentation.description}
              />
            }
          >
            <Suspense
              fallback={
                <>
                  <ProductDetailMedia>
                    <div className="h-[300px] animate-pulse rounded-lg bg-muted" />
                  </ProductDetailMedia>
                  <ProductDetailPurchase>
                    <PurchaseSkeleton />
                  </ProductDetailPurchase>
                </>
              }
            >
              <SelectedProduct {...props} product={product} />
            </Suspense>
          </ProductDetailLayout>
        </ProductDetail>
    </>
  );
}
