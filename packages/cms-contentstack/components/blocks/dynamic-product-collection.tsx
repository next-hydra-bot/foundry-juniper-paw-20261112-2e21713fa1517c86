import { ProductCollectionGrid } from "@repo/commerce-core/product/product-collection";

import {
  ProductCatalogSkeleton,
  ProductCollectionLayout,
} from "@repo/design-system/components/commerce/blocks/product-collection";
import type { Locale } from "@repo/i18n";
import { Option } from "effect";
import { Suspense } from "react";

import type { ResultOf } from "../../graphql";
import { decodeCommerceCategoryId } from "../../lib/commerce-category";
import { renderRichText } from "../../lib/utils/rich-text-utils";
import type { ComponentBaseProps } from "../../types";
import { ProductCollectionBlock } from "./product-collection-fragment";

type ProductCollectionData = NonNullable<
  Extract<
    ResultOf<typeof ProductCollectionBlock>,
    { DynamicProductCollection: unknown }
  >["DynamicProductCollection"]
>;

export function DynamicProductCollection(
  props: {
    data: ProductCollectionData;
    locale: Locale;
  } & ComponentBaseProps
) {
  const { data, locale } = props;
  const { description, heading, product_category: productCategory } = data;
  const title = heading ?? "";
  const descriptionJson = description?.json;
  const categoryId = decodeCommerceCategoryId(productCategory);

  if (Option.isNone(categoryId)) {
    return null;
  }

  return (
    (
      <ProductCollectionLayout
        description={renderRichText(descriptionJson)}
        title={title}
      >
        <Suspense fallback={<ProductCatalogSkeleton />}>
            <ProductCollectionGrid
              categoryId={categoryId.value}
              limit={data.limit ?? 3}
              locale={locale}
            />
          </Suspense>
      </ProductCollectionLayout>
    )
  );
}

DynamicProductCollection.fragment = ProductCollectionBlock;
DynamicProductCollection.contentField = "dynamic_product_collection";
