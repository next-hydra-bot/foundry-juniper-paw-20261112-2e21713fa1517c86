import { Schema } from "effect";

import { CatalogAssignmentInput } from "../domain/catalog-assignment";
import { CommerceBusinessUnitKey } from "../domain/commerce-account";
import type { CatalogSources } from "./model";
import type { SellingCatalog } from "./selling";

export const CompanyCatalogAssignments = Schema.Struct({
  assignments: Schema.NonEmptyArray(
    Schema.toEncoded(
      Schema.Struct({
        ...CatalogAssignmentInput.fields,
        businessUnitKey: CommerceBusinessUnitKey,
      })
    )
  ),
});
export type CompanyCatalogAssignments = typeof CompanyCatalogAssignments.Type;
export type CompanyCatalogAssignment =
  CompanyCatalogAssignments["assignments"][number];

/** Companies select pricing; all buyers in a Store share its market assortment. */
export const companyCatalogPlans = (
  assignments: CompanyCatalogAssignments,
  selling: SellingCatalog,
  catalogs: CatalogSources
) => {
  const keys = new Set<string>();
  const buyers = new Set<string>();
  const catalog = catalogs[selling.sourceCatalog];
  if (!catalog) {
    throw new Error(`Unknown source catalog: ${selling.sourceCatalog}`);
  }
  return assignments.assignments.map((assignment) => {
    const buyer = `${assignment.storeKey}/${assignment.businessUnitKey}`;
    if (keys.has(assignment.key) || buyers.has(buyer)) {
      throw new Error(
        `Ambiguous company catalog assignment: ${assignment.key}`
      );
    }
    keys.add(assignment.key);
    buyers.add(buyer);
    const store = selling.stores.find(
      ({ storeKey, locale }) =>
        storeKey === assignment.storeKey && locale === assignment.locale
    );
    const assortment = selling.assortments.find(
      ({ key }) => key === store?.assortmentKey
    );
    const matchingGroups = selling.pricingGroups.filter(
      ({ key }) => key === assignment.pricingGroupKey
    );
    const [pricingGroup] = matchingGroups;
    const matchingPrices = selling.priceLists.filter(
      ({ key, currency }) =>
        pricingGroup?.priceListKeys.includes(key) &&
        currency === store?.currency
    );
    const [priceList] = matchingPrices;
    if (
      matchingGroups.length !== 1 ||
      matchingPrices.length !== 1 ||
      !store ||
      !assortment ||
      !priceList ||
      !pricingGroup ||
      priceList.currency !== store.currency
    ) {
      throw new Error(
        `Invalid Store, assortment or price list for ${assignment.key}`
      );
    }
    const products = catalog.products.filter(({ key }) =>
      assortment.productKeys.includes(key)
    );
    if (products.length !== assortment.productKeys.length) {
      throw new Error(`Unknown assortment products for ${assignment.key}`);
    }
    for (const product of products) {
      for (const variant of product.variants) {
        if (!priceList.prices.some(({ sku }) => sku === variant.sku)) {
          throw new Error(
            `Missing fixed price for ${assignment.key}/${variant.sku}`
          );
        }
      }
    }
    return { assignment, assortment, priceList, pricingGroup, products, store };
  });
};
export type CompanyCatalogPlan = ReturnType<typeof companyCatalogPlans>[number];
export const companyCatalogAssignmentsJsonSchema = () => {
  const document = Schema.toJsonSchemaDocument(CompanyCatalogAssignments, {
    onExcessProperty: "error",
  });
  return {
    $defs: document.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    allOf: [document.schema],
  };
};
