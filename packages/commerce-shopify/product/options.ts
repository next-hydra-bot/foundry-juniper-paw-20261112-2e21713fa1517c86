import {
  productModel,
  productTypeDefinition,
} from "@repo/commerce-core/catalog/product-model";
import type { ProductModel } from "@repo/commerce-core/catalog/product-model";
import { Schema } from "effect";

import { ShopifyImage } from "../client/schema";

export const ShopifyProductOptions = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    optionValues: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        swatch: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              color: Schema.NullOr(Schema.String),
              image: Schema.NullOr(
                Schema.Struct({ previewImage: Schema.NullOr(ShopifyImage) })
              ),
            })
          )
        ),
      })
    ),
  })
);

/** Provider IDs bind imported domain keys; display strings stay in Shopify. */
export const OptionBindings = Schema.Record(
  Schema.String,
  Schema.Struct({
    id: Schema.String,
    values: Schema.Record(Schema.String, Schema.String),
  })
);
export type OptionBindings = typeof OptionBindings.Type;
export const OptionBindingsMetafield = Schema.NullOr(
  Schema.Struct({
    type: Schema.Literal("json"),
    value: Schema.fromJsonString(OptionBindings),
  })
);

export type ProductOptionLabels = Readonly<
  Record<
    string,
    {
      readonly label: string;
      readonly values: Readonly<Record<string, string>>;
    }
  >
>;

export const readOptionLabels = (
  options: typeof ShopifyProductOptions.Type,
  bindings: OptionBindings
): ProductOptionLabels =>
  Object.fromEntries(
    Object.entries(bindings).map(([key, binding]) => {
      const option = options.find(({ id }) => id === binding.id);
      if (option === undefined) {
        throw new Error(
          `Missing bound Shopify option: ${key}; rerun the catalog migration`
        );
      }
      const values = Object.fromEntries(
        Object.entries(binding.values).map(([valueKey, id]) => {
          const value = option.optionValues.find(
            (candidate) => candidate.id === id
          );
          if (value === undefined) {
            throw new Error(
              `Missing bound Shopify option value: ${valueKey}; rerun the catalog migration`
            );
          }
          return [valueKey, value.name];
        })
      );
      return [key, { label: option.name, values }];
    })
  );

export const readOptionSelections = (
  type: string,
  attributes: Readonly<Record<string, Schema.Json>>,
  labels: ProductOptionLabels,
  model: ProductModel = productModel
) => {
  const definition = productTypeDefinition(type, model);
  return definition.variantOptions.flatMap((key) => {
    const value = attributes[key];
    if (value === undefined) {
      return [];
    }
    const attribute = definition.attributes.find(
      (candidate) => candidate.key === key
    );
    const valueKey =
      attribute?.type === "enum"
        ? Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }))(value)
            .key
        : String(
            Schema.decodeUnknownSync(
              Schema.Union([Schema.String, Schema.Finite])
            )(value)
          );
    const option = labels[key];
    const valueLabel = option?.values[valueKey];
    if (option === undefined || valueLabel === undefined) {
      throw new Error(
        `Missing Shopify option binding: ${key}/${valueKey}; rerun the catalog migration`
      );
    }
    const swatch = attribute?.values?.find(
      ({ key: candidate }) => candidate === valueKey
    )?.swatch;
    return [
      {
        key,
        label: option.label,
        value:
          swatch === undefined
            ? { key: valueKey, label: valueLabel }
            : { key: valueKey, label: valueLabel, swatch },
      },
    ];
  });
};
