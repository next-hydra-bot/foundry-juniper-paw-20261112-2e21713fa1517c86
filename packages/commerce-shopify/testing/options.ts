import type { CatalogProduct } from "@repo/commerce-core/catalog";

import { productOptionTranslations } from "../catalog/mapping";

export const catalogOptionsFixture = (
  product: CatalogProduct,
  locale = "en-US"
) => {
  const translations = productOptionTranslations(product, [locale]);
  const options = product.options.map((option, index) => ({
    id: `gid://shopify/ProductOption/${index + 1}`,
    name: translations[index]?.translations[locale]?.name ?? option.label,
    optionValues: option.values.map((value, valueIndex) => ({
      id: `gid://shopify/ProductOptionValue/${index * 100 + valueIndex + 1}`,
      name:
        translations[index]?.values[valueIndex]?.translations[locale]?.name ??
        value.label,
    })),
  }));
  return {
    optionBindings: {
      type: "json" as const,
      value: Object.fromEntries(
        product.options.map((option, index) => [
          option.key,
          {
            id: `gid://shopify/ProductOption/${index + 1}`,
            values: Object.fromEntries(
              option.values.map((value, valueIndex) => [
                value.key,
                `gid://shopify/ProductOptionValue/${index * 100 + valueIndex + 1}`,
              ])
            ),
          },
        ])
      ),
    },
    options,
  };
};
