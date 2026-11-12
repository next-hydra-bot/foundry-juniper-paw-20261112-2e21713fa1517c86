import type { ProductDetail } from "./generated/attributes";
import type { ProductVariantCard } from "./model";

export const toProductVariantCards = (
  product: ProductDetail
): readonly ProductVariantCard[] =>
  product.variants.map((variant) => ({
    availability: variant.availability,
    featuredImage: variant.images[0],
    id: variant.id,
    options: product.options.flatMap((option) => {
      const selected = option.values.find(
        (value) => value.key === variant.optionValues[option.key]
      );
      return selected ? [{ name: option.label, value: selected.label }] : [];
    }),
    price: variant.price,
    productId: product.id,
    sku: variant.sku,
    slug: product.slug,
    title: product.title,
  }));
