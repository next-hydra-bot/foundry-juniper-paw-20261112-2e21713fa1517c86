import { Schema } from "effect";

import { ProductOptionSwatch } from "../product/model";
import input from "./product-model.json";

const Key = Schema.String.check(Schema.isPattern(/^[a-z][a-zA-Z0-9-]*$/u));
const Locale = Schema.String.check(
  Schema.isPattern(/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u)
);
const Labels = Schema.Record(Locale, Schema.NonEmptyString);
export const ProductAttributeDefinition = Schema.Struct({
  key: Key,
  labels: Labels,
  list: Schema.optional(Schema.Boolean),
  maxLength: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  maximum: Schema.optional(Schema.Finite),
  minLength: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
  minimum: Schema.optional(Schema.Finite),
  required: Schema.Boolean,
  type: Schema.Literals([
    "text",
    "number",
    "integer",
    "boolean",
    "enum",
    "product-reference",
  ]),
  values: Schema.optional(
    Schema.NonEmptyArray(
      Schema.Struct({
        key: Schema.NonEmptyString,
        labels: Labels,
        swatch: Schema.optional(ProductOptionSwatch),
      })
    )
  ),
  variantConstraint: Schema.optional(
    Schema.Literals(["same", "unique", "combination"])
  ),
});
export type ProductAttributeDefinition = typeof ProductAttributeDefinition.Type;
export const ProductTypeDefinition = Schema.Struct({
  attributes: Schema.Array(ProductAttributeDefinition),
  cartSummary: Schema.optional(Schema.Array(Key)),
  description: Schema.String,
  key: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u)
  ),
  labels: Labels,
  searchFacets: Schema.optional(Schema.Array(Key)),
  variantOptions: Schema.Array(Key),
});
export type ProductTypeDefinition = typeof ProductTypeDefinition.Type;
export const ProductModel = Schema.Struct({
  defaultLocale: Locale,
  productTypes: Schema.NonEmptyArray(ProductTypeDefinition),
  schemaVersion: Schema.Literal(1),
});
export type ProductModel = typeof ProductModel.Type;

export const modelLabel = (
  labels: Readonly<Record<string, string>>,
  locale: string,
  fallback = "en-US"
) => labels[locale] ?? labels[fallback] ?? Object.values(labels)[0] ?? "";

/** Keeps generated public type names distinct from the shared Product interfaces. */
export const productTypeIdentifier = (key: string) => {
  const identifier = key
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
  return identifier === "Product" ? "CatalogProduct" : identifier;
};

const validateSearchFacets = (type: ProductTypeDefinition) => {
  const keys = type.searchFacets ?? [];
  if (new Set(keys).size !== keys.length) {
    throw new Error(`Duplicate search facet: ${type.key}`);
  }
  for (const key of keys) {
    const attribute = type.attributes.find(
      (attribute) => attribute.key === key
    );
    if (attribute === undefined || attribute.type === "product-reference") {
      throw new Error(`Invalid search facet: ${type.key}.${key}`);
    }
  }
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON authoring and tool input boundary.
export const decodeProductModel = (value: unknown): ProductModel => {
  const model = Schema.decodeUnknownSync(ProductModel)(value, {
    onExcessProperty: "error",
  });
  const typeKeys = new Set<string>();
  const identifiers = new Set<string>();
  for (const type of model.productTypes) {
    const identifier = productTypeIdentifier(type.key);
    if (typeKeys.has(type.key) || identifiers.has(identifier)) {
      throw new Error(`Duplicate Product Type identity: ${type.key}`);
    }
    typeKeys.add(type.key);
    identifiers.add(identifier);
    if (type.labels[model.defaultLocale] === undefined) {
      throw new Error(`Missing default label: ${type.key}`);
    }
    const keys = new Set<string>();
    for (const attribute of type.attributes) {
      if (keys.has(attribute.key)) {
        throw new Error(`Duplicate attribute: ${type.key}.${attribute.key}`);
      }
      keys.add(attribute.key);
      if (
        [
          "productType",
          "variantImages",
          "seedCatalog",
          "seedCategory",
          "__proto__",
          "constructor",
          "prototype",
        ].includes(attribute.key)
      ) {
        throw new Error(`Reserved attribute key: ${attribute.key}`);
      }
      if (attribute.labels[model.defaultLocale] === undefined) {
        throw new Error(`Missing default attribute label: ${attribute.key}`);
      }
      if (attribute.type === "enum") {
        if (attribute.values === undefined) {
          throw new Error(`Enum requires values: ${attribute.key}`);
        }
        if (
          new Set(attribute.values.map(({ key }) => key)).size !==
          attribute.values.length
        ) {
          throw new Error(`Duplicate enum value: ${attribute.key}`);
        }
        const labels = new Set<string>();
        for (const value of attribute.values) {
          const label = value.labels[model.defaultLocale];
          if (label === undefined || labels.has(label)) {
            throw new Error(
              `Missing or ambiguous enum label: ${attribute.key}`
            );
          }
          labels.add(label);
        }
      } else if (attribute.values !== undefined) {
        throw new Error(`Only enums declare values: ${attribute.key}`);
      }
      const numeric =
        attribute.type === "number" || attribute.type === "integer";
      if (
        !numeric &&
        (attribute.minimum !== undefined || attribute.maximum !== undefined)
      ) {
        throw new Error(`Numeric constraint on ${attribute.key}`);
      }
      if (
        attribute.type !== "text" &&
        (attribute.minLength !== undefined || attribute.maxLength !== undefined)
      ) {
        throw new Error(`Text constraint on ${attribute.key}`);
      }
      if (
        (attribute.minimum ?? -Infinity) > (attribute.maximum ?? Infinity) ||
        (attribute.minLength ?? 0) > (attribute.maxLength ?? Infinity)
      ) {
        throw new Error(`Invalid range: ${attribute.key}`);
      }
      if (
        attribute.key === "relatedProducts" &&
        (attribute.type !== "product-reference" ||
          !attribute.list ||
          attribute.required)
      ) {
        throw new Error(
          "relatedProducts must be optional product references; catalog relatedProductKeys supplies its values"
        );
      }
    }
    validateSearchFacets(type);
    if (new Set(type.variantOptions).size !== type.variantOptions.length) {
      throw new Error(`Duplicate variant option: ${type.key}`);
    }
    for (const key of [...type.variantOptions, ...(type.cartSummary ?? [])]) {
      const attribute = type.attributes.find(
        (attribute) => attribute.key === key
      );
      if (
        attribute === undefined ||
        attribute.list ||
        !["text", "number", "integer", "enum"].includes(attribute.type)
      ) {
        throw new Error(`Invalid variant option: ${type.key}.${key}`);
      }
    }
  }
  return model;
};
export const productModel = decodeProductModel(input);
export const productTypeDefinition = (
  key: string,
  model: ProductModel = productModel
) => {
  const definition = model.productTypes.find((type) => type.key === key);
  if (definition === undefined) {
    throw new Error(`Unknown Product Type: ${key}`);
  }
  return definition;
};

export const attributeSchema = (attribute: ProductAttributeDefinition) => {
  let scalar: Schema.Codec<Schema.Json>;
  switch (attribute.type) {
    case "text": {
      let text = Schema.String;
      if (attribute.minLength !== undefined) {
        text = text.check(Schema.isMinLength(attribute.minLength));
      }
      if (attribute.maxLength !== undefined) {
        text = text.check(Schema.isMaxLength(attribute.maxLength));
      }
      scalar = text;
      break;
    }
    case "number":
    case "integer": {
      let number = attribute.type === "integer" ? Schema.Int : Schema.Finite;
      if (attribute.minimum !== undefined) {
        number = number.check(Schema.isGreaterThanOrEqualTo(attribute.minimum));
      }
      if (attribute.maximum !== undefined) {
        number = number.check(Schema.isLessThanOrEqualTo(attribute.maximum));
      }
      scalar = number;
      break;
    }
    case "boolean": {
      scalar = Schema.Boolean;
      break;
    }
    case "product-reference": {
      scalar = Schema.NonEmptyString;
      break;
    }
    case "enum": {
      scalar = Schema.Struct({
        key: Schema.Literals((attribute.values ?? []).map(({ key }) => key)),
        label: Schema.NonEmptyString,
      });
      break;
    }
    default: {
      throw new Error("Unsupported attribute type");
    }
  }
  return attribute.list
    ? Schema.Array(scalar).check(
        Schema.makeFilter(
          (values) =>
            new Set(values.map((value) => JSON.stringify(value))).size ===
            values.length,
          { expected: "unique list values" }
        )
      )
    : scalar;
};
export const attributesSchema = (type: ProductTypeDefinition, input = false) =>
  Schema.Struct(
    Object.fromEntries(
      type.attributes
        .filter(({ key }) => !input || key !== "relatedProducts")
        .map((attribute) => {
          const schema = attributeSchema(attribute);
          return [
            attribute.key,
            attribute.required ? schema : Schema.optionalKey(schema),
          ];
        })
    )
  );

export const productModelJsonSchema = () => {
  const document = Schema.toJsonSchemaDocument(ProductModel, {
    onExcessProperty: "error",
  });
  return {
    $defs: document.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    allOf: [document.schema],
  };
};
