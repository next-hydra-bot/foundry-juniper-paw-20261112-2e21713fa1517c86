import { Schema } from "effect";

import { Money } from "../domain/money";
import {
  CategoryId,
  CategorySlug,
  ProductId,
  ProductOptionKey,
  ProductOptionValueKey,
  ProductOptionValueId,
  ProductSlug,
  Sku,
  VariantId,
} from "./identity";
import { ProductImage } from "./image";

export const ProductCard = Schema.Struct({
  availableForSale: Schema.Boolean,
  description: Schema.optional(Schema.String),
  featuredImage: Schema.optional(ProductImage),
  id: ProductId,
  /** Regular price of the same Variant supplying startingPrice, when it is on sale. */
  regularStartingPrice: Schema.optional(Money),
  slug: ProductSlug,
  startingPrice: Schema.optional(Money),
  title: Schema.NonEmptyString,
});
export type ProductCard = typeof ProductCard.Type;

export const ProductPrice = Schema.Struct({
  discounted: Schema.optional(Money),
  regular: Money,
});
export type ProductPrice = typeof ProductPrice.Type;

export const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0)
).pipe(Schema.brand("NonNegativeInt"));
export type NonNegativeInt = typeof NonNegativeInt.Type;

export const ProductAvailability = Schema.Struct({
  availableForSale: Schema.Boolean,
  availableQuantity: Schema.optional(NonNegativeInt),
});
export type ProductAvailability = typeof ProductAvailability.Type;

/** Current catalog information for an exact saved Variant, independent of list storage. */
export const ProductVariantCard = Schema.Struct({
  availability: ProductAvailability,
  featuredImage: Schema.optional(ProductImage),
  id: VariantId,
  options: Schema.Array(
    Schema.Struct({ name: Schema.String, value: Schema.String })
  ),
  price: Schema.optional(ProductPrice),
  productId: ProductId,
  sku: Schema.optional(Sku),
  slug: ProductSlug,
  title: Schema.NonEmptyString,
});
export type ProductVariantCard = typeof ProductVariantCard.Type;

export const ProductOptionSwatch = Schema.Struct({
  color: Schema.optional(
    Schema.String.check(Schema.isPattern(/^#[\da-f]{6}$/iu))
  ),
  image: Schema.optional(ProductImage),
}).check(
  Schema.makeFilter(
    (value) => value.color !== undefined || value.image !== undefined,
    { expected: "a swatch color or image" }
  )
);
export type ProductOptionSwatch = typeof ProductOptionSwatch.Type;

export const ProductOptionValue = Schema.Struct({
  id: Schema.optional(ProductOptionValueId),
  key: ProductOptionValueKey,
  label: Schema.NonEmptyString,
  swatch: Schema.optional(ProductOptionSwatch),
});
export type ProductOptionValue = typeof ProductOptionValue.Type;

export const ProductOption = Schema.Struct({
  key: ProductOptionKey,
  label: Schema.NonEmptyString,
  values: Schema.NonEmptyArray(ProductOptionValue),
});
export type ProductOption = typeof ProductOption.Type;

export const ProductCategory = Schema.Struct({
  id: CategoryId,
  name: Schema.optional(Schema.String),
  slug: Schema.optional(CategorySlug),
});
export type ProductCategory = typeof ProductCategory.Type;

export const makeProductVariantSchema = <Attributes extends Schema.Top>(
  attributes: Attributes
) =>
  Schema.Struct({
    attributes,
    availability: ProductAvailability,
    id: VariantId,
    images: Schema.Array(ProductImage),
    optionValues: Schema.Record(ProductOptionKey, ProductOptionValueKey),
    price: Schema.optional(ProductPrice),
    sku: Schema.optional(Sku),
  });

export const makeProductDetailSchema = <
  ProductType extends Schema.Top,
  Variant extends Schema.Top,
>(
  productType: ProductType,
  variant: Variant
) =>
  Schema.Struct({
    categories: Schema.Array(ProductCategory),
    defaultVariantId: VariantId,
    description: Schema.optional(Schema.String),
    id: ProductId,
    options: Schema.Array(ProductOption),
    productType,
    slug: ProductSlug,
    title: Schema.NonEmptyString,
    variants: Schema.NonEmptyArray(variant),
  });

type ProductDetailInvariantInput = {
  readonly defaultVariantId: string;
  readonly options: readonly {
    readonly key: string;
    readonly values: readonly { readonly key: string }[];
  }[];
  readonly variants: readonly {
    readonly id: string;
    readonly optionValues: Readonly<Record<string, string>>;
  }[];
};

export const hasDefaultProductVariant = (
  detail: ProductDetailInvariantInput
): boolean =>
  detail.variants.some((variant) => variant.id === detail.defaultVariantId);

export const hasUniqueProductVariantIds = (
  detail: ProductDetailInvariantInput
): boolean =>
  new Set(detail.variants.map((variant) => variant.id)).size ===
  detail.variants.length;

export const hasCompleteProductOptionSelection = (
  detail: ProductDetailInvariantInput
): boolean =>
  detail.variants.every((variant) => {
    const selectedValues = Object.entries(variant.optionValues);
    return (
      selectedValues.length === detail.options.length &&
      detail.options.every((option) =>
        option.values.some(
          (value) => variant.optionValues[option.key] === value.key
        )
      )
    );
  });
