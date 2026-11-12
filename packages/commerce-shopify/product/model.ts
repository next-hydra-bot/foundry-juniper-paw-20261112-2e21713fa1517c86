import {
  productModel,
  modelLabel,
} from "@repo/commerce-core/catalog/product-model";
import type {
  ProductAttributeDefinition,
  ProductModel,
} from "@repo/commerce-core/catalog/product-model";

export const metafieldType = (attribute: ProductAttributeDefinition) => {
  const types = {
    boolean: "boolean",
    enum: "single_line_text_field",
    integer: "number_integer",
    number: "number_decimal",
    "product-reference": "product_reference",
    text: "single_line_text_field",
  };
  const scalar = types[attribute.type];
  return attribute.list ? `list.${scalar}` : scalar;
};
export const modelMetafields = (model: ProductModel = productModel) => {
  const fields = model.productTypes.flatMap((type) =>
    type.attributes.map((attribute) => ({ attribute, productType: type.key }))
  );
  return fields.map(({ productType, attribute }) => {
    const conflict = fields.some(
      (field) =>
        field.attribute.key === attribute.key &&
        metafieldType(field.attribute) !== metafieldType(attribute)
    );
    if (conflict) {
      throw new Error(
        `Shopify attribute ${attribute.key} has incompatible types across product types; use distinct attribute keys`
      );
    }
    const { key } = attribute;
    if (key.length < 2 || key.length > 64) {
      throw new Error(
        `Shopify metafield key must contain 2–64 characters: ${key}`
      );
    }
    return {
      attributeKey: attribute.key,
      key,
      name: modelLabel(attribute.labels, model.defaultLocale),
      productType,
      type: metafieldType(attribute),
    };
  });
};
export const modelMetafieldDefinitions = (
  model: ProductModel = productModel
) => [
  {
    key: "productType",
    name: "Commerce product type",
    type: "single_line_text_field",
  },
  ...new Map(
    modelMetafields(model).map(({ key, name, type }) => [
      key,
      { key, name, type },
    ])
  ).values(),
];
export const attributeDefinitions = modelMetafieldDefinitions();
export const attributeIdentifiers = attributeDefinitions.map(({ key }) => ({
  key,
  namespace: "commerce",
}));
if (attributeIdentifiers.length > 250) {
  throw new Error(
    "Shopify attribute queries support at most 250 field identifiers; split the product model before using this provider"
  );
}
export const attributeField = (
  type: string,
  key: string,
  model: ProductModel = productModel
) => {
  const field = modelMetafields(model).find(
    (field) => field.productType === type && field.attributeKey === key
  );
  if (field === undefined) {
    throw new Error(`Unknown Shopify model attribute: ${type}.${key}`);
  }
  return field;
};
