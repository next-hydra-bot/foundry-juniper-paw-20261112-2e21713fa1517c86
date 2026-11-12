import { ProductDetail } from "@repo/commerce-core/product/generated/attributes";
import {
  ProductCard,
  ProductOptionSwatch,
} from "@repo/commerce-core/product/model";
import { productOptionsFromSelections } from "@repo/commerce-core/product/selection";
import type { Store } from "@repo/commerce-core/store";
import { Schema } from "effect";

import { mapMoney } from "../client/schema";
import { readAttributes, readProductType, visibleOptions } from "./attributes";
import { readOptionLabels, readOptionSelections } from "./options";
import type {
  ShopifyProduct,
  ShopifyProductCard,
  ShopifyVariant,
} from "./schema";

export const mapProductCard = (product: ShopifyProductCard, store: Store) => {
  if (product.priceVariants.pageInfo.hasNextPage) {
    throw new Error("Complete Shopify card price pagination before mapping");
  }
  const startingPrice = mapMoney(product.priceRange.minVariantPrice, store);
  const references = product.priceVariants.nodes.flatMap((variant) => {
    const price = mapMoney(variant.price, store);
    if (price.centAmount !== startingPrice.centAmount) {
      return [];
    }
    return [
      variant.compareAtPrice === null
        ? price
        : mapMoney(variant.compareAtPrice, store),
    ];
  });
  let regular: (typeof references)[number] | undefined;
  for (const reference of references) {
    if (regular === undefined || reference.centAmount < regular.centAmount) {
      regular = reference;
    }
  }
  return Schema.decodeUnknownSync(ProductCard)({
    availableForSale: product.availableForSale,
    description: product.description,
    featuredImage: product.featuredImage
      ? {
          altText: product.featuredImage.altText ?? undefined,
          url: product.featuredImage.url,
        }
      : undefined,
    id: product.id,
    regularStartingPrice:
      regular && regular.centAmount > startingPrice.centAmount
        ? regular
        : undefined,
    slug: product.handle,
    startingPrice,
    title: product.title,
  });
};

const variantImages = (
  variant: ShopifyVariant,
  fallback: ShopifyVariant["image"]
) => {
  if (variant.gallery?.references.pageInfo.hasNextPage) {
    throw new Error(
      "Variant gallery exceeds the supported Storefront reference page"
    );
  }
  const images =
    variant.gallery === null
      ? []
      : variant.gallery.references.nodes.flatMap(({ image }) =>
          image === null ? [] : [image]
        );
  if (variant.gallery === null && fallback !== null) {
    images.push(fallback);
  }
  return images.map(({ url, altText }) =>
    altText === null ? { url } : { altText, url }
  );
};

export const mapProductDetail = (
  product: ShopifyProduct,
  variants: readonly ShopifyVariant[],
  store: Store
) => {
  if (product.collections.pageInfo.hasNextPage) {
    throw new Error(
      "Product categories exceed the supported Storefront collection page"
    );
  }
  const productType = readProductType(product.metafields);
  const labels = readOptionLabels(
    product.options,
    product.optionBindings?.value ?? {}
  );
  const attributes = variants.map((variant) =>
    readAttributes(productType, product.metafields, variant.metafields, labels)
  );
  const selections = variants.map((variant, index) =>
    productType === "generic-product"
      ? visibleOptions(variant.selectedOptions).map(({ name, value }) => ({
          key: name,
          label: name,
          value: { key: value, label: value },
        }))
      : readOptionSelections(productType, attributes[index] ?? {}, labels)
  );
  const options = productOptionsFromSelections(selections).map((option) => {
    const binding = product.optionBindings?.value[option.key];
    const native = product.options.find(({ id, name }) =>
      binding === undefined ? name === option.key : id === binding.id
    );
    return {
      ...option,
      values: option.values.map((value) => {
        const nativeValue = native?.optionValues.find(({ id, name }) =>
          binding === undefined
            ? name === value.key
            : id === binding.values[value.key]
        );
        const color = nativeValue?.swatch?.color;
        const image = nativeValue?.swatch?.image?.previewImage;
        const swatch =
          color || image
            ? Schema.decodeUnknownSync(ProductOptionSwatch)({
                color: color ?? undefined,
                image: image
                  ? { url: image.url, altText: image.altText ?? undefined }
                  : undefined,
              })
            : value.swatch;
        const mapped =
          nativeValue === undefined ? value : { ...value, id: nativeValue.id };
        return swatch === undefined ? mapped : { ...mapped, swatch };
      }),
    };
  });
  return Schema.decodeUnknownSync(ProductDetail)({
    categories: product.collections.nodes
      .filter(
        (collection) =>
          collection.seedCatalog === null || collection.seedCategory !== null
      )
      .map(({ id, title, handle }) => ({ id, name: title, slug: handle })),
    defaultVariantId:
      variants.find((variant) => variant.availableForSale)?.id ??
      variants[0]?.id,
    description: product.description,
    id: product.id,
    options,
    productType,
    slug: product.handle,
    title: product.title,
    variants: variants.map((variant, index) => {
      const price = mapMoney(variant.price, store);
      const compareAt = variant.compareAtPrice
        ? mapMoney(variant.compareAtPrice, store)
        : undefined;
      const image = variant.image ?? product.featuredImage;
      return {
        attributes: attributes[index],
        availability: {
          availableForSale: variant.availableForSale,
          availableQuantity:
            variant.currentlyNotInStock || variant.quantityAvailable === null
              ? undefined
              : Math.max(0, variant.quantityAvailable),
        },
        id: variant.id,
        images: variantImages(variant, image),
        optionValues: Object.fromEntries(
          (selections[index] ?? []).map(({ key, value }) => [key, value.key])
        ),
        price:
          compareAt && compareAt.centAmount > price.centAmount
            ? { discounted: price, regular: compareAt }
            : { regular: price },
        sku: variant.sku === "" ? undefined : (variant.sku ?? undefined),
      };
    }),
  });
};
