import { localeTagPattern, localization } from "@repo/site-config";
import { Array as EffectArray, pipe, Schema } from "effect";

import { Money } from "../domain/money";
import { ProductImage } from "../product/image";
import {
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Pure domain schema factory, not an Effect service constructor.
  makeProductDetailSchema,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Pure domain schema factory, not an Effect service constructor.
  makeProductVariantSchema,
  hasCompleteProductOptionSelection,
  ProductOption,
  ProductPrice,
} from "../product/model";
import { productAttributeSelections } from "../product/selection";
import {
  attributesSchema,
  productModel,
  productTypeDefinition,
  modelLabel,
} from "./product-model";
import type { ProductModel, ProductTypeDefinition } from "./product-model";

const CatalogKey = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u));
export const CatalogLocale = Schema.String.check(
  Schema.isPattern(localeTagPattern)
);
export const CatalogTranslation = Schema.Struct({
  description: Schema.String,
  title: Schema.NonEmptyString,
});
export const CatalogCategory = Schema.Struct({
  description: Schema.String,
  key: CatalogKey,
  title: Schema.NonEmptyString,
  translations: Schema.Record(CatalogLocale, CatalogTranslation),
});
export type CatalogCategory = typeof CatalogCategory.Type;
export const CatalogImage = Schema.Struct({
  ...ProductImage.fields,
  height: Schema.Int.check(Schema.isGreaterThan(0)),
  width: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type CatalogImage = typeof CatalogImage.Type;
const makeProductSchema = <
  Type extends Schema.Top,
  Attributes extends Schema.Top,
>(
  type: Type,
  attributes: Attributes
) =>
  Schema.Struct({
    categoryKeys: Schema.Array(CatalogKey),
    description: Schema.String,
    key: CatalogKey,
    options: Schema.Array(ProductOption),
    productType: type,
    relatedProductKeys: Schema.Array(CatalogKey),
    title: Schema.NonEmptyString,
    translations: Schema.Record(CatalogLocale, CatalogTranslation),
    variants: Schema.NonEmptyArray(
      Schema.Struct({
        attributes,
        images: Schema.Array(CatalogImage),
        optionValues: Schema.Record(
          Schema.NonEmptyString,
          Schema.NonEmptyString
        ),
        price: ProductPrice,
        quantity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        sku: Schema.NonEmptyString,
      })
    ),
  });

export const CatalogProduct = makeProductSchema(
  Schema.NonEmptyString,
  Schema.Record(Schema.String, Schema.Json)
);
export type CatalogProduct = typeof CatalogProduct.Type;
const productFields = CatalogProduct.fields;
const variantFields = productFields.variants.value.fields;
export const CatalogProductContent = Schema.Struct({
  key: productFields.key,
  title: productFields.title,
  description: productFields.description,
  productType: productFields.productType,
  options: productFields.options,
  translations: productFields.translations,
  variants: Schema.NonEmptyArray(
    Schema.Struct({
      attributes: variantFields.attributes,
      images: variantFields.images,
      optionValues: variantFields.optionValues,
      price: variantFields.price,
      sku: variantFields.sku,
    })
  ),
});
export type CatalogProductContent = typeof CatalogProductContent.Type;
export const CatalogProductReferences = Schema.Struct({
  key: productFields.key,
  productType: productFields.productType,
  relatedProductKeys: productFields.relatedProductKeys,
  variants: Schema.Array(
    Schema.Struct({
      attributes: variantFields.attributes,
      sku: variantFields.sku,
    })
  ),
});
export type CatalogProductReferences = typeof CatalogProductReferences.Type;
export const Catalog = Schema.Struct({
  categories: Schema.Array(CatalogCategory),
  defaultLocale: CatalogLocale,
  products: Schema.NonEmptyArray(CatalogProduct),
});
export type Catalog = typeof Catalog.Type;
export type CatalogSources = Readonly<Record<string, Catalog>>;
export const CatalogName = CatalogKey;
export type CatalogName = typeof CatalogName.Type;

const referenceAttributeKeys = (product: Pick<CatalogProduct, "productType">) =>
  new Set(
    productTypeDefinition(product.productType)
      .attributes.filter(({ type }) => type === "product-reference")
      .map(({ key }) => key)
  );

/** Product content writers leave stock and reference fields to their owners. */
export const catalogProductContent = (
  product: CatalogProduct
): CatalogProductContent => {
  const references = referenceAttributeKeys(product);
  const {
    categoryKeys: _categories,
    relatedProductKeys: _related,
    ...content
  } = product;
  return {
    ...content,
    variants: pipe(
      product.variants,
      EffectArray.map(({ attributes, quantity: _quantity, ...variant }) => ({
        ...variant,
        attributes: Object.fromEntries(
          Object.entries(attributes).filter(([key]) => !references.has(key))
        ),
      }))
    ),
  };
};

export const catalogProductReferences = (
  product: CatalogProduct
): CatalogProductReferences => {
  const references = referenceAttributeKeys(product);
  return {
    key: product.key,
    productType: product.productType,
    relatedProductKeys: product.relatedProductKeys,
    variants: product.variants.map(({ attributes, sku }) => ({
      sku,
      attributes: Object.fromEntries(
        Object.entries(attributes).filter(([key]) => references.has(key))
      ),
    })),
  };
};

/** Source product keys for both the built-in relationship and custom reference attributes. */
export const catalogReferenceKeys = (
  product: CatalogProductReferences,
  model: ProductModel = productModel
): readonly string[] => {
  const references = new Set(product.relatedProductKeys);
  for (const attribute of productTypeDefinition(
    product.productType,
    model
  ).attributes.filter(({ type }) => type === "product-reference")) {
    for (const variant of product.variants) {
      const value = variant.attributes[attribute.key];
      if (value === undefined) {
        continue;
      }
      for (const key of attribute.list
        ? Schema.decodeUnknownSync(Schema.Array(Schema.String))(value)
        : [Schema.decodeUnknownSync(Schema.String)(value)]) {
        references.add(key);
      }
    }
  }
  return [...references];
};

const validateEnumLabels = (
  attributes: CatalogProduct["variants"][number]["attributes"],
  definition: ProductTypeDefinition,
  locale: string,
  model: ProductModel
) => {
  for (const attribute of definition.attributes.filter(
    ({ type }) => type === "enum"
  )) {
    const raw = attributes[attribute.key];
    if (raw === undefined) {
      continue;
    }
    for (const value of attribute.list
      ? Schema.decodeUnknownSync(
          Schema.Array(
            Schema.Struct({ key: Schema.String, label: Schema.String })
          )
        )(raw)
      : [
          Schema.decodeUnknownSync(
            Schema.Struct({ key: Schema.String, label: Schema.String })
          )(raw),
        ]) {
      const declared = attribute.values?.find(({ key }) => key === value.key);
      if (
        declared === undefined ||
        value.label !== modelLabel(declared.labels, locale, model.defaultLocale)
      ) {
        throw new Error(
          `Enum label does not match model: ${attribute.key}/${value.key}`
        );
      }
    }
  }
};
const validateVariantConstraints = (
  product: CatalogProduct,
  definition: ProductTypeDefinition
) => {
  const combinationKeys = definition.attributes
    .filter(({ variantConstraint }) => variantConstraint === "combination")
    .map(({ key }) => key);
  if (
    combinationKeys.length > 0 &&
    new Set(
      product.variants.map((variant) =>
        JSON.stringify(combinationKeys.map((key) => variant.attributes[key]))
      )
    ).size !== product.variants.length
  ) {
    throw new Error(`Attribute combination must be unique: ${product.key}`);
  }
  for (const attribute of definition.attributes) {
    const values = product.variants
      .map((variant) => variant.attributes[attribute.key])
      .filter((value) => value !== undefined)
      .map((value) => JSON.stringify(value));
    if (
      attribute.variantConstraint === "same" &&
      new Set(
        product.variants.map((variant) =>
          JSON.stringify(variant.attributes[attribute.key])
        )
      ).size > 1
    ) {
      throw new Error(
        `Attribute must be the same across variants: ${attribute.key}`
      );
    }
    if (
      attribute.variantConstraint === "unique" &&
      new Set(values).size !== values.length
    ) {
      throw new Error(
        `Attribute must be unique across variants: ${attribute.key}`
      );
    }
  }
};

export const validateCatalog = (
  catalog: Catalog,
  model: ProductModel = productModel
): Catalog => {
  const { products, categories, defaultLocale } = catalog;
  const categoryKeys = new Set<string>();
  for (const category of categories) {
    if (categoryKeys.has(category.key)) {
      throw new Error(`Duplicate catalog category: ${category.key}`);
    }
    categoryKeys.add(category.key);
    if (Object.hasOwn(category.translations, defaultLocale)) {
      throw new Error(`Default locale must use base content: ${category.key}`);
    }
  }
  const keys = new Set<string>();
  const skus = new Set<string>();
  for (const product of products) {
    const definition = productTypeDefinition(product.productType, model);
    const variantSchema = attributesSchema(definition, true);
    if (
      product.relatedProductKeys.length > 0 &&
      !definition.attributes.some(({ key }) => key === "relatedProducts")
    ) {
      throw new Error(
        `Product Type ${definition.key} does not declare relatedProducts`
      );
    }
    if (keys.has(product.key)) {
      throw new Error(`Duplicate catalog product: ${product.key}`);
    }
    keys.add(product.key);
    if (Object.hasOwn(product.translations, defaultLocale)) {
      throw new Error(`Default locale must use base content: ${product.key}`);
    }
    if (new Set(product.categoryKeys).size !== product.categoryKeys.length) {
      throw new Error(`Duplicate product category: ${product.key}`);
    }
    for (const key of product.categoryKeys) {
      if (!categoryKeys.has(key)) {
        throw new Error(`Missing catalog category: ${key}`);
      }
    }
    const imageMetadata = new Map<string, string>();
    if (
      new Set(product.options.map(({ key }) => key)).size !==
      product.options.length
    ) {
      throw new Error(`Duplicate option definition: ${product.key}`);
    }
    const combinations = new Set<string>();
    for (const variant of product.variants) {
      Schema.decodeUnknownSync(variantSchema)(variant.attributes, {
        onExcessProperty: "error",
      });
      validateEnumLabels(
        variant.attributes,
        definition,
        catalog.defaultLocale,
        model
      );
      if (skus.has(variant.sku)) {
        throw new Error(`Duplicate catalog SKU: ${variant.sku}`);
      }
      skus.add(variant.sku);
      const variantImageUrls = new Set<string>();
      for (const image of variant.images) {
        if (variantImageUrls.has(image.url)) {
          throw new Error(`Duplicate variant image: ${variant.sku}`);
        }
        variantImageUrls.add(image.url);
        const metadata = JSON.stringify([
          image.altText,
          image.width,
          image.height,
        ]);
        if (
          imageMetadata.has(image.url) &&
          imageMetadata.get(image.url) !== metadata
        ) {
          throw new Error(`Conflicting shared image metadata: ${image.url}`);
        }
        imageMetadata.set(image.url, metadata);
      }
      const selected = productAttributeSelections(
        product.productType,
        variant.attributes,
        model,
        catalog.defaultLocale
      );
      if (
        selected.length !== product.options.length ||
        selected.some(({ key, label, value }) => {
          const option = product.options.find(
            (candidate) => candidate.key === key
          );
          return (
            variant.optionValues[key] !== value.key ||
            option?.label !== label ||
            option.values.find((candidate) => candidate.key === value.key)
              ?.label !== value.label
          );
        })
      ) {
        throw new Error(
          `Catalog options do not match typed attributes: ${variant.sku}`
        );
      }
      const combination = JSON.stringify(
        product.options.map(({ key }) => variant.optionValues[key])
      );
      if (combinations.has(combination)) {
        throw new Error(`Duplicate variant selection: ${product.key}`);
      }
      combinations.add(combination);
      const { regular, discounted } = variant.price;
      for (const money of discounted === undefined
        ? [regular]
        : [regular, discounted]) {
        Schema.decodeUnknownSync(Money)(money);
        if (!Number.isSafeInteger(money.centAmount) || money.centAmount < 0) {
          throw new Error(
            "Catalog prices require nonnegative safe minor units"
          );
        }
      }
      if (
        discounted !== undefined &&
        (discounted.currencyCode !== regular.currencyCode ||
          discounted.centAmount >= regular.centAmount)
      ) {
        throw new Error(
          "Discounted price must be lower and use the regular price currency"
        );
      }
    }
    const detail = Schema.decodeUnknownSync(
      makeProductDetailSchema(
        Schema.String,
        makeProductVariantSchema(variantSchema)
      )
    )({
      categories: [],
      defaultVariantId: product.variants[0].sku,
      description: product.description,
      id: product.key,
      options: product.options,
      productType: product.productType,
      slug: product.key,
      title: product.title,
      variants: product.variants.map((variant) => ({
        ...variant,
        availability: {
          availableForSale: variant.quantity > 0,
          availableQuantity: variant.quantity,
        },
        id: variant.sku,
        images: variant.images.map(({ url, altText }) =>
          altText === undefined ? { url } : { altText, url }
        ),
      })),
    });
    if (!hasCompleteProductOptionSelection(detail)) {
      throw new Error(`Incomplete option selection: ${product.key}`);
    }
    validateVariantConstraints(product, definition);
  }
  for (const product of products) {
    for (const key of catalogReferenceKeys(product, model)) {
      if (!keys.has(key)) {
        throw new Error(`Missing related catalog product: ${key}`);
      }
    }
  }
  return catalog;
};

/** Accepts a parsed tool input or JSON value. File loading belongs to the CLI entry point. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This public parser is the JSON/tool-input boundary; it immediately decodes Catalog.
export const decodeCatalog = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Public JSON parser immediately decodes the input.
  input: unknown,
  model: ProductModel = productModel
): Catalog =>
  validateCatalog(
    Schema.decodeUnknownSync(Catalog)(input, { onExcessProperty: "error" }),
    model
  );

/** Structural JSON Schema for authoring and tools; decodeCatalog also checks cross-record invariants. */
export const catalogJsonSchema = (model: ProductModel = productModel) => {
  const schema = Schema.Struct({
    ...Catalog.fields,
    defaultLocale: Schema.Literals(localization.locales),
    products: Schema.NonEmptyArray(
      Schema.Union(
        model.productTypes.map((type) =>
          makeProductSchema(
            Schema.Literal(type.key),
            attributesSchema(type, true)
          )
        )
      )
    ),
  });
  const document = Schema.toJsonSchemaDocument(schema, {
    onExcessProperty: "error",
  });
  return {
    $defs: document.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    allOf: [document.schema],
  };
};
