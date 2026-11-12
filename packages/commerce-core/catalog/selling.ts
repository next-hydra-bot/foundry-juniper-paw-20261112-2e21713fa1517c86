import { Schema } from "effect";

import {
  AssortmentInput,
  AssortmentKey,
  CatalogPriceListInput,
  CompanyPricingGroupInput,
} from "../domain/pricing";
import { Store, validateStoreConfiguration } from "../store";
import type { CatalogSources } from "./model";

const Key = Schema.NonEmptyString;
// Compatibility exports retain the JSON representation used by existing imports.
// Validation and generated JSON schemas come from the canonical domain inputs.
export const Assortment = Schema.toEncoded(AssortmentInput);
export const CatalogPriceList = Schema.toEncoded(CatalogPriceListInput);
export const CompanyPricingGroup = Schema.toEncoded(CompanyPricingGroupInput);
export type CompanyPricingGroup = typeof CompanyPricingGroup.Type;
export const SellingCatalog = Schema.Struct({
  assortments: Schema.NonEmptyArray(Assortment),
  key: Key,
  priceLists: Schema.NonEmptyArray(CatalogPriceList),
  pricingGroups: Schema.NonEmptyArray(CompanyPricingGroup),
  sourceCatalog: Key,
  stores: Schema.NonEmptyArray(
    Schema.Struct({
      ...Store.fields,
      assortmentKey: Schema.toEncoded(AssortmentKey),
      displayCode: Schema.optional(Schema.NonEmptyString),
      displayName: Schema.optional(Schema.NonEmptyString),
      isDefault: Schema.Boolean,
    })
  ),
});
export type SellingCatalog = typeof SellingCatalog.Type;
export type Assortment = typeof Assortment.Type;
export type CatalogPriceList = typeof CatalogPriceList.Type;

export const decodeSellingCatalog = (
  input: Schema.Json,
  catalogs: CatalogSources
): SellingCatalog => {
  const selling = Schema.decodeUnknownSync(SellingCatalog)(input, {
    onExcessProperty: "error",
  });
  validateStoreConfiguration(selling.stores);
  const catalog = catalogs[selling.sourceCatalog];
  if (!catalog) {
    throw new Error(`Unknown source catalog: ${selling.sourceCatalog}`);
  }
  const products = new Set(catalog.products.map(({ key }) => key));
  const skus = new Set(
    catalog.products.flatMap(({ variants }) => variants.map(({ sku }) => sku))
  );
  const assortments = new Set<string>();
  for (const assortment of selling.assortments) {
    if (
      assortments.has(assortment.key) ||
      new Set(assortment.productKeys).size !== assortment.productKeys.length ||
      assortment.productKeys.some((key) => !products.has(key))
    ) {
      throw new Error(
        `Duplicate or unknown assortment/product: ${assortment.key}`
      );
    }
    assortments.add(assortment.key);
  }
  const storeAssortments = new Map<string, string>();
  for (const store of selling.stores) {
    const current = storeAssortments.get(store.storeKey);
    if (current !== undefined && current !== store.assortmentKey) {
      throw new Error(
        `Store ${store.storeKey} must share one market assortment across its locales`
      );
    }
    storeAssortments.set(store.storeKey, store.assortmentKey);
    if (!assortments.has(store.assortmentKey)) {
      throw new Error(`Unknown Store assortment: ${store.assortmentKey}`);
    }
  }
  const lists = new Set<string>();
  for (const list of selling.priceLists) {
    if (
      lists.has(list.key) ||
      new Set(list.prices.map(({ sku }) => sku)).size !== list.prices.length ||
      list.prices.some(
        ({ sku, centAmount }) =>
          !skus.has(sku) || !Number.isSafeInteger(centAmount)
      )
    ) {
      throw new Error(`Duplicate or unknown price list/SKU: ${list.key}`);
    }
    lists.add(list.key);
  }
  const groups = new Set<string>();
  for (const group of selling.pricingGroups) {
    const prices = group.priceListKeys.map((key) =>
      selling.priceLists.find((list) => list.key === key)
    );
    if (
      groups.has(group.key) ||
      prices.some((list) => !list) ||
      new Set(prices.map((list) => list?.currency)).size !== prices.length
    ) {
      throw new Error(
        `Duplicate or invalid company pricing group: ${group.key}`
      );
    }
    groups.add(group.key);
  }
  return selling;
};

export const sellingCatalogJsonSchema = () => {
  const document = Schema.toJsonSchemaDocument(SellingCatalog, {
    onExcessProperty: "error",
  });
  return {
    $defs: document.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    allOf: [document.schema],
  };
};
