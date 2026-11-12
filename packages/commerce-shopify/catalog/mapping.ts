import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Catalog, CatalogProduct } from "@repo/commerce-core/catalog";
import {
  bundledCatalogFiles,
  catalogReaders,
} from "@repo/commerce-core/catalog/files";
import type {
  CatalogFiles,
  CatalogReaders,
} from "@repo/commerce-core/catalog/files";
import type { ProductModel } from "@repo/commerce-core/catalog/product-model";
import {
  productModel,
  productTypeDefinition,
} from "@repo/commerce-core/catalog/product-model";
import type { Money } from "@repo/commerce-core/domain/money";
import { locales } from "@repo/i18n/config";
import { Schema } from "effect";

import { attributeField } from "../product/model";

export const toMetafields = (
  attributes: CatalogProduct["variants"][number]["attributes"],
  productType?: string,
  model: ProductModel = productModel
) =>
  Object.entries(attributes).flatMap(([key, value]) => {
    const type =
      productType ??
      model.productTypes.find((type) =>
        type.attributes.some((attribute) => attribute.key === key)
      )?.key;
    if (type === undefined) {
      throw new Error(`Unsupported Shopify catalog attribute: ${key}`);
    }
    const definition = productTypeDefinition(type, model).attributes.find(
      (attribute) => attribute.key === key
    );
    if (definition === undefined) {
      throw new Error(`Unsupported Shopify catalog attribute: ${key}`);
    }
    if (definition.type === "product-reference") {
      return [];
    }
    const field = attributeField(type, key, model);
    const scalar = (value: Schema.Json) =>
      definition.type === "enum"
        ? Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }))(value)
            .key
        : Schema.decodeUnknownSync(
            Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
          )(value);
    const encoded = definition.list
      ? JSON.stringify(
          Schema.decodeUnknownSync(Schema.Array(Schema.Json))(value).map(scalar)
        )
      : String(scalar(value));
    return [
      {
        key: field.key,
        namespace: "commerce",
        type: field.type,
        value: encoded,
      },
    ];
  });

/** Encode minor units exactly at the configured currency precision. */
export const shopifyMoney = (money: Money) => {
  if (!Number.isSafeInteger(money.centAmount) || money.centAmount < 0) {
    throw new Error("Shopify import requires nonnegative safe minor units");
  }
  const amount = BigInt(money.centAmount);
  const precision =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: money.currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(precision);
  return precision === 0
    ? String(amount)
    : `${amount / scale}.${String(amount % scale).padStart(precision, "0")}`;
};

export const productOptions = (product: Pick<CatalogProduct, "options">) =>
  product.options.length === 0
    ? [{ name: "Title", values: [{ name: "Default Title" }] }]
    : product.options.map(({ label, values }, index) => ({
        name: label,
        position: index + 1,
        values: values.map(({ label: value }) => ({ name: value })),
      }));

export const variantOptions = (
  product: Pick<CatalogProduct, "options">,
  variant: Pick<CatalogProduct["variants"][number], "optionValues" | "sku">
) =>
  product.options.length === 0
    ? [{ name: "Default Title", optionName: "Title" }]
    : product.options.map((option) => {
        const value = option.values.find(
          (item) => item.key === variant.optionValues[option.key]
        );
        if (value === undefined) {
          throw new Error(`Missing Shopify option selection: ${variant.sku}`);
        }
        return { name: value.label, optionName: option.label };
      });

const bundledPaths = new Set(
  Object.values(bundledCatalogFiles).map((url) => fileURLToPath(url))
);

export const shopifyCatalogReaders = (
  files: CatalogFiles = bundledCatalogFiles
): CatalogReaders =>
  Object.fromEntries(
    Object.entries(catalogReaders(files)).map(([name, read]) => [
      name,
      () => {
        const catalog = read();
        const file = files[name];
        const bundled =
          file !== undefined &&
          bundledPaths.has(
            typeof file === "string" ? resolve(file) : fileURLToPath(file)
          );

        // The shop's primary English copy already serves Canadian English.
        // Select the workspace's French variant when both seed copies exist.
        const preferCanadianFrench = locales.some(
          (locale: string) => locale === "fr-CA"
        );
        const translations = <
          T extends Catalog["categories"][number] | CatalogProduct,
        >(
          record: T
        ): T => {
          const entries = { ...record.translations };
          const canadianEnglish = entries["en-CA"];
          if (
            catalog.defaultLocale === "en-US" &&
            canadianEnglish?.title === record.title &&
            canadianEnglish.description === record.description
          ) {
            delete entries["en-CA"];
          }
          if (bundled && entries["fr-CA"] && entries["fr-FR"]) {
            delete entries[preferCanadianFrench ? "fr-FR" : "fr-CA"];
          }
          return { ...record, translations: entries };
        };
        const [first, ...rest] = catalog.products;
        return {
          ...catalog,
          categories: catalog.categories.map(translations),
          products: [translations(first), ...rest.map(translations)],
        };
      },
    ])
  );

export const catalogTranslationLocales = (catalog: Catalog) =>
  [
    ...new Set(
      [...catalog.products, ...catalog.categories].flatMap((item) =>
        Object.keys(item.translations)
      )
    ),
  ].filter((locale) => locale !== catalog.defaultLocale);

/** Only export model labels for languages used by this catalog. */
export const productOptionTranslations = (
  product: Pick<CatalogProduct, "options" | "productType">,
  locales: readonly string[],
  model: ProductModel = productModel
) => {
  const definition = productTypeDefinition(product.productType, model);
  const translations = (labels: Readonly<Record<string, string>>) =>
    Object.fromEntries(
      Object.entries(labels)
        .filter(([locale]) => locales.includes(locale))
        .map(([locale, name]) => [locale, { name }])
    );
  return product.options.map((option) => {
    const attribute = definition.attributes.find(
      (candidate) => candidate.key === option.key
    );
    if (attribute === undefined) {
      throw new Error(
        `Unknown product option: ${product.productType}.${option.key}`
      );
    }
    return {
      key: option.key,
      name: option.label,
      translations: translations(attribute.labels),
      values: option.values.map((value) => ({
        key: value.key,
        name: value.label,
        translations: translations(
          attribute.values?.find(({ key }) => key === value.key)?.labels ?? {}
        ),
      })),
    };
  });
};

export const htmlText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const shopifyLocale = (locale: string, available: readonly string[]) => {
  if (available.includes(locale)) {
    return locale;
  }
  const [language] = locale.split("-");
  if (language !== undefined && available.includes(language)) {
    return language;
  }
  throw new Error(
    `Enable and publish the Shopify locale for ${locale} before importing translations`
  );
};
