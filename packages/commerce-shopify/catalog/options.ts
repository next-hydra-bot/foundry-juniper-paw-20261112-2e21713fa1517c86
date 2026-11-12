import { CatalogProduct } from "@repo/commerce-core/catalog";
import { Schema } from "effect";

import type { OptionBindings } from "../product/options";

export const OptionResources = Schema.Struct({
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      optionValues: Schema.Array(Schema.Struct({ id: Schema.String })),
      position: Schema.Int,
    })
  ),
  variants: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        selectedOptions: Schema.Array(
          Schema.Struct({ optionValue: Schema.Struct({ id: Schema.String }) })
        ),
        sku: Schema.NullOr(Schema.String),
      })
    ),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  }),
});

const variantFields = CatalogProduct.fields.variants.value.fields;
export const ShopifyProductTranslation = Schema.Struct({
  key: CatalogProduct.fields.key,
  productType: CatalogProduct.fields.productType,
  options: CatalogProduct.fields.options,
  translations: CatalogProduct.fields.translations,
  variants: Schema.Array(
    Schema.Struct({
      sku: variantFields.sku,
      optionValues: variantFields.optionValues,
    })
  ),
});
export type ShopifyProductTranslation = typeof ShopifyProductTranslation.Type;
/** Source option positions and variant SKUs join native IDs without consulting display labels. */
export const bindProductOptions = (
  product: Pick<ShopifyProductTranslation, "options" | "variants">,
  native: typeof OptionResources.Type
): OptionBindings => {
  if (native.variants.pageInfo.hasNextPage) {
    throw new Error("Option binding exceeds the importer variant page");
  }
  return Object.fromEntries(
    product.options.map((option, index) => {
      const target = native.options.find(
        ({ position }) => position === index + 1
      );
      if (target === undefined) {
        throw new Error(`Missing imported option position: ${index + 1}`);
      }
      const values = new Map<string, string>();
      for (const variant of product.variants) {
        const sourceKey = variant.optionValues[option.key];
        const imported = native.variants.nodes.find(
          ({ sku }) => sku === variant.sku
        );
        const selections =
          imported?.selectedOptions.filter(({ optionValue }) =>
            target.optionValues.some(({ id }) => id === optionValue.id)
          ) ?? [];
        const [selection] = selections;
        if (
          sourceKey === undefined ||
          selections.length !== 1 ||
          selection === undefined
        ) {
          throw new Error(
            `Missing imported option selection: ${variant.sku}/${option.key}`
          );
        }
        const { id } = selection.optionValue;
        if (values.has(sourceKey) && values.get(sourceKey) !== id) {
          throw new Error(
            `Inconsistent imported option IDs: ${option.key}/${sourceKey}`
          );
        }
        values.set(sourceKey, id);
      }
      return [
        option.key,
        { id: target.id, values: Object.fromEntries(values) },
      ];
    })
  );
};
