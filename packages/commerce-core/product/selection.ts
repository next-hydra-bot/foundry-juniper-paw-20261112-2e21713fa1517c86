import { Schema } from "effect";

import {
  modelLabel,
  productModel,
  productTypeDefinition,
} from "../catalog/product-model";
import type { ProductModel } from "../catalog/product-model";
import { ProductAttributeEnumValue } from "./attributes";
import type { ProductOptionSwatch } from "./model";

/** Product Type-owned selection dimensions, independent of provider storage. */
export const productAttributeSelections = (
  type: string,
  attributes: Readonly<Record<string, Schema.Json>>,
  model: ProductModel = productModel,
  locale: string = model.defaultLocale
) => {
  const definition = productTypeDefinition(type, model);
  return definition.variantOptions.flatMap((key) => {
    const attribute = definition.attributes.find(
      (attribute) => attribute.key === key
    );
    const value = attributes[key];
    if (attribute === undefined || value === undefined) {
      return [];
    }
    const selection =
      attribute.type === "enum"
        ? Schema.decodeUnknownSync(ProductAttributeEnumValue)(value)
        : {
            key: String(
              Schema.decodeUnknownSync(
                Schema.Union([Schema.String, Schema.Finite])
              )(value)
            ),
            label: String(
              Schema.decodeUnknownSync(
                Schema.Union([Schema.String, Schema.Finite])
              )(value)
            ),
          };
    const swatch = attribute.values?.find(
      ({ key: valueKey }) => valueKey === selection.key
    )?.swatch;
    return [
      {
        key,
        label: modelLabel(attribute.labels, locale, model.defaultLocale),
        value: swatch === undefined ? selection : { ...selection, swatch },
      },
    ];
  });
};

interface ProductSelection {
  readonly key: string;
  readonly label: string;
  readonly value: {
    readonly key: string;
    readonly label: string;
    readonly id?: string;
    readonly swatch?: ProductOptionSwatch;
  };
}

export const productOptionsFromSelections = (
  variants: readonly (readonly ProductSelection[])[]
) => {
  const options = new Map<
    string,
    {
      key: string;
      label: string;
      values: Map<string, ProductSelection["value"]>;
    }
  >();
  for (const selections of variants) {
    for (const selection of selections) {
      const option = options.get(selection.key) ?? {
        key: selection.key,
        label: selection.label,
        values: new Map(),
      };
      option.values.set(selection.value.key, selection.value);
      options.set(selection.key, option);
    }
  }
  return [...options.values()].map((option) => ({
    key: option.key,
    label: option.label,
    values: [...option.values.values()],
  }));
};
