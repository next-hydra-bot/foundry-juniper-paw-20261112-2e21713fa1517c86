import {
  attributesSchema,
  productModel,
  productTypeDefinition,
  modelLabel,
} from "@repo/commerce-core/catalog/product-model";
import type {
  ProductAttributeDefinition,
  ProductModel,
} from "@repo/commerce-core/catalog/product-model";
import { ProductTypeKey } from "@repo/commerce-core/product/generated/attributes";
import { Schema } from "effect";

import { attributeField } from "./model";
import type { ProductOptionLabels } from "./options";

export { attributeDefinitions } from "./model";

export const ShopifyMetafield = Schema.Struct({
  key: Schema.String,
  type: Schema.String,
  value: Schema.String,
});
export const ShopifyMetafields = Schema.Array(Schema.NullOr(ShopifyMetafield));
export const SelectedOptions = Schema.Array(
  Schema.Struct({ name: Schema.String, value: Schema.String })
);
type Metafields = typeof ShopifyMetafields.Type;
type Options = typeof SelectedOptions.Type;
export const visibleOptions = (options: Options) =>
  options.filter(
    ({ name, value }) => name !== "Title" || value !== "Default Title"
  );
export const readProductType = (metafields: Metafields) => {
  const field = metafields.find((item) => item?.key === "productType");
  if (field === null || field === undefined) {
    return Schema.decodeUnknownSync(ProductTypeKey)("generic-product");
  }
  if (field.type !== "single_line_text_field") {
    throw new Error("Invalid commerce product type metafield");
  }
  return Schema.decodeUnknownSync(ProductTypeKey)(field.value);
};
const scalarValue = (
  attribute: ProductAttributeDefinition,
  value: Schema.Json,
  label: string | undefined,
  model: ProductModel
): Schema.Json => {
  if (attribute.type !== "enum") {
    return value;
  }
  const key = Schema.decodeUnknownSync(Schema.String)(value);
  const selected = attribute.values?.find((candidate) => candidate.key === key);
  if (selected === undefined) {
    throw new Error(`Unknown enum key: ${attribute.key}/${key}`);
  }
  return {
    key,
    label: label ?? modelLabel(selected.labels, model.defaultLocale),
  };
};
export const readAttributes = (
  productType: string,
  productFields: Metafields,
  variantFields: Metafields,
  options: ProductOptionLabels,
  model: ProductModel = productModel
) => {
  const definition = productTypeDefinition(productType, model);
  const values: Record<string, Schema.Json> = {};
  for (const attribute of definition.attributes) {
    const mapping = attributeField(productType, attribute.key, model);
    const field = [...variantFields, ...productFields].find(
      (field) => field?.key === mapping.key
    );
    if (field !== undefined && field !== null) {
      if (field.type !== mapping.type) {
        throw new Error(`Invalid commerce metafield type: ${field.key}`);
      }
      if (attribute.list) {
        values[attribute.key] = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Array(Schema.Json))
        )(field.value).map((value) =>
          scalarValue(attribute, value, undefined, model)
        );
      } else if (attribute.type === "number" || attribute.type === "integer") {
        if (field.value.trim() === "") {
          throw new Error("Empty numeric metafield");
        }
        values[attribute.key] = Number(field.value);
      } else if (attribute.type === "boolean") {
        values[attribute.key] = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.Boolean)
        )(field.value);
      } else {
        values[attribute.key] = scalarValue(
          attribute,
          field.value,
          options[attribute.key]?.values[field.value],
          model
        );
      }
    }
    if (definition.variantOptions.includes(attribute.key)) {
      const value = values[attribute.key];
      if (value !== undefined) {
        const key =
          attribute.type === "enum"
            ? Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }))(
                value
              ).key
            : String(
                Schema.decodeUnknownSync(
                  Schema.Union([Schema.String, Schema.Finite])
                )(value)
              );
        if (options[attribute.key]?.values[key] === undefined) {
          throw new Error(
            `Missing Shopify option binding: ${attribute.key}/${key}; rerun the catalog migration`
          );
        }
      }
    }
  }
  return Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
    Schema.decodeUnknownSync(attributesSchema(definition))(values, {
      onExcessProperty: "error",
    })
  );
};
export const optionSummary = (options: Options) => {
  const selected = visibleOptions(options);
  return selected.length === 0
    ? undefined
    : {
        label: selected.map(({ name }) => name).join(" / "),
        value: selected.map(({ value }) => value).join(" / "),
      };
};
