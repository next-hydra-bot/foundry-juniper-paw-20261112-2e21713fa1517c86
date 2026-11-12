import { Schema } from "effect";

export const ProductId = Schema.NonEmptyString.pipe(Schema.brand("ProductId"));
export type ProductId = typeof ProductId.Type;

export const ProductSlug = Schema.NonEmptyString.pipe(
  Schema.brand("ProductSlug")
);
export type ProductSlug = typeof ProductSlug.Type;

/** Opaque purchasable reference produced and resolved by the selected provider. */
export const VariantId = Schema.NonEmptyString.pipe(Schema.brand("VariantId"));
export type VariantId = typeof VariantId.Type;

export const Sku = Schema.NonEmptyString.pipe(Schema.brand("Sku"));
export type Sku = typeof Sku.Type;

export const CategoryId = Schema.NonEmptyString.pipe(
  Schema.brand("CategoryId")
);
export type CategoryId = typeof CategoryId.Type;

export const CategorySlug = Schema.NonEmptyString.pipe(
  Schema.brand("CategorySlug")
);
export type CategorySlug = typeof CategorySlug.Type;

/** Stable classification identity, independent of its localized URL. */
export const CategoryKey = Schema.NonEmptyString.pipe(
  Schema.brand("CategoryKey")
);
export type CategoryKey = typeof CategoryKey.Type;

export const ProductOptionKey = Schema.NonEmptyString.pipe(
  Schema.brand("ProductOptionKey")
);
export type ProductOptionKey = typeof ProductOptionKey.Type;

export const ProductOptionValueKey = Schema.NonEmptyString.pipe(
  Schema.brand("ProductOptionValueKey")
);
export type ProductOptionValueKey = typeof ProductOptionValueKey.Type;

export const ProductOptionValueId = Schema.NonEmptyString.pipe(
  Schema.brand("ProductOptionValueId")
);
export type ProductOptionValueId = typeof ProductOptionValueId.Type;
