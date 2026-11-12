import {
  generateMetadataHandler,
  ProductDetailPage,
} from "@repo/commerce-core/product/product-detail";
import { withShopifyProductSearchParams } from "@repo/commerce-provider/product/search-params";

import { ProductDetailSkeleton } from "@repo/design-system/components/commerce/blocks/product-detail-skeleton";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/products/[slug]">): Promise<Metadata> {
  const { slug, locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return await generateMetadataHandler({ locale, slug });
}

export default async function ProductDetail({
  params,
  searchParams,
}: PageProps<"/[locale]/products/[slug]">) {
  const { slug, locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Migrate to root params later.
  setRequestLocale(locale);
  return (
    (
      <Suspense fallback={<ProductDetailSkeleton />}>
        <ProductDetailPage
          slug={slug}
          locale={locale}
          searchParams={withShopifyProductSearchParams(searchParams)}
        />
      </Suspense>
    )
  );
}
