import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProductAttributeDefinition, ProductModel } from "./product-model";
import { productTypeIdentifier } from "./product-model";

const typeName = productTypeIdentifier;
const keyName = (key: string) =>
  `${typeName(key)}${typeName(key).endsWith("Product") ? "TypeKey" : "ProductTypeKey"}`;
const attributeExpression = (attribute: ProductAttributeDefinition): string => {
  let expression: string;
  switch (attribute.type) {
    case "text": {
      expression = "Schema.String";
      break;
    }
    case "number": {
      expression = "Schema.Finite";
      break;
    }
    case "integer": {
      expression = "Schema.Int";
      break;
    }
    case "boolean": {
      expression = "Schema.Boolean";
      break;
    }
    case "product-reference": {
      expression = "ProductId";
      break;
    }
    case "enum": {
      expression = `makeProductAttributeEnumValueSchema(${JSON.stringify(attribute.values?.map(({ key }) => key))})`;
      break;
    }
    default: {
      throw new Error("Unsupported attribute type");
    }
  }
  const filters = [
    attribute.minimum === undefined
      ? undefined
      : `Schema.isGreaterThanOrEqualTo(${attribute.minimum})`,
    attribute.maximum === undefined
      ? undefined
      : `Schema.isLessThanOrEqualTo(${attribute.maximum})`,
    attribute.minLength === undefined
      ? undefined
      : `Schema.isMinLength(${attribute.minLength})`,
    attribute.maxLength === undefined
      ? undefined
      : `Schema.isMaxLength(${attribute.maxLength})`,
  ].filter((filter) => filter !== undefined);
  if (filters.length > 0) {
    expression += `.check(${filters.join(", ")})`;
  }
  return attribute.list ? `Schema.Array(${expression})` : expression;
};

export const generateProductModelSource = (model: ProductModel) => {
  const types = model.productTypes;
  const attributes = types.flatMap((type) => type.attributes);
  const enums = attributes.some(({ type }) => type === "enum")
    ? 'import { makeProductAttributeEnumValueSchema } from "../attributes";\n'
    : "";
  const references = attributes.some(({ type }) => type === "product-reference")
    ? 'import { ProductId } from "../identity";\n'
    : "";
  return `// Generated from catalog/product-model.json. Do not edit manually.
// Run pnpm --filter @repo/commerce-core catalog generate to regenerate.
import { Schema } from "effect";
${enums}${references}import { hasCompleteProductOptionSelection, hasDefaultProductVariant, hasUniqueProductVariantIds, makeProductDetailSchema, makeProductVariantSchema } from "../model";

export const productModelSignature = ${JSON.stringify(createHash("sha256").update(JSON.stringify(model)).digest("hex"))};
${types.map(({ key }) => `const ${keyName(key)} = Schema.Literal(${JSON.stringify(key)}).pipe(Schema.brand("ProductTypeKey"));\ntype ${keyName(key)} = typeof ${keyName(key)}.Type;`).join("\n")}
export const ProductTypeKey = Schema.Union([${types.map(({ key }) => keyName(key)).join(", ")}]);
export type ProductTypeKey = typeof ProductTypeKey.Type;
${types.map(({ key, attributes }) => `export const ${typeName(key)}Attributes = ${attributes.length === 0 ? "Schema.Record(Schema.String, Schema.Never)" : `Schema.Struct({\n${attributes.map((attribute) => `${JSON.stringify(attribute.key)}: ${attribute.required ? attributeExpression(attribute) : `Schema.optional(${attributeExpression(attribute)})`},`).join("\n")}\n})`};\nexport type ${typeName(key)}Attributes = typeof ${typeName(key)}Attributes.Type;`).join("\n")}
export const ProductAttributesSchemaByProductType = {
${types.map(({ key }) => `${JSON.stringify(key)}: ${typeName(key)}Attributes,`).join("\n")}
} as const;
export type ProductAttributesByProductType = {
${types.map(({ key }) => `readonly ${JSON.stringify(key)}: ${typeName(key)}Attributes;`).join("\n")}
};
export type ProductAttributes<TKey extends ProductTypeKey = ProductTypeKey> = ${types.map(({ key }) => `TKey extends ${keyName(key)} ? ${typeName(key)}Attributes`).join(" : ")} : never;
${types.map(({ key }) => `const ${typeName(key)}Variant = makeProductVariantSchema(${typeName(key)}Attributes);`).join("\n")}
export const ProductVariant = Schema.Union([${types.map(({ key }) => `${typeName(key)}Variant`).join(", ")}]);
const ProductDetailSchema = Schema.Union([${types.map(({ key }) => `makeProductDetailSchema(${keyName(key)}, ${typeName(key)}Variant)`).join(", ")}]);
export const ProductDetail = ProductDetailSchema.check(
Schema.makeFilter(hasDefaultProductVariant, { expected: "defaultVariantId to identify a Product Variant" }),
Schema.makeFilter(hasUniqueProductVariantIds, { expected: "unique Product Variant IDs" }),
Schema.makeFilter(hasCompleteProductOptionSelection, { expected: "every Product Variant to select one defined value for every Product Option" })
);
type ProductDetailForKey<Detail, TKey extends ProductTypeKey> = Detail extends { readonly productType: TKey } ? Detail : never;
export type ProductDetail<TKey extends ProductTypeKey = ProductTypeKey> = ProductDetailForKey<typeof ProductDetail.Type, TKey>;
export type ProductVariant<TKey extends ProductTypeKey = ProductTypeKey> = ProductDetail<TKey>["variants"][number];
`;
};
export const generateProductModel = async (
  model: ProductModel,
  coreDirectory: string
) => {
  await mkdir(path.join(coreDirectory, "product/generated"), {
    recursive: true,
  });
  await writeFile(
    path.join(coreDirectory, "product/generated/attributes.ts"),
    generateProductModelSource(model)
  );
  await writeFile(
    path.join(coreDirectory, "catalog/product-model.json"),
    `${JSON.stringify(model, null, 2)}\n`
  );
};
