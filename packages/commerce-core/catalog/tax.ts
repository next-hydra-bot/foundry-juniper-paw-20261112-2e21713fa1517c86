import { Schema } from "effect";

import type { Catalog } from "./model";

/** A merchant-owned classification, independent of a provider's rate engine. */
export const TaxClassKey = Schema.NonEmptyString.pipe(
  Schema.brand("TaxClassKey")
);
export const TaxClassInput = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  key: TaxClassKey,
  name: Schema.NonEmptyString,
});
export type TaxClassInput = typeof TaxClassInput.Type;

export const CatalogTaxSetup = Schema.Struct({
  classes: Schema.NonEmptyArray(TaxClassInput),
  products: Schema.NonEmptyArray(
    Schema.Struct({
      productKey: Schema.NonEmptyString,
      taxClassKey: TaxClassKey,
    })
  ),
});
export type CatalogTaxSetup = typeof CatalogTaxSetup.Type;

/** Opting into tax provisioning requires one explicit assignment per imported Product. */
export const validateCatalogTaxSetup = (
  setup: CatalogTaxSetup,
  catalogs: Readonly<Record<string, Catalog>>
) => {
  const classes = new Set<string>(setup.classes.map(({ key }) => key));
  const products = new Set(
    Object.values(catalogs).flatMap((catalog) =>
      catalog.products.map(({ key }) => key)
    )
  );
  const assigned = new Set<string>();
  if (classes.size !== setup.classes.length) {
    throw new Error("Tax Class keys must be unique.");
  }
  for (const assignment of setup.products) {
    if (
      !products.has(assignment.productKey) ||
      !classes.has(assignment.taxClassKey) ||
      assigned.has(assignment.productKey)
    ) {
      throw new Error(
        `Invalid or duplicate tax assignment: ${assignment.productKey}/${assignment.taxClassKey}`
      );
    }
    assigned.add(assignment.productKey);
  }
  if (assigned.size !== products.size) {
    throw new Error(
      "Assign a Tax Class to every imported Product, including zero-rated or exempt Products."
    );
  }
};

export const validateTaxClassMappings = (
  setup: CatalogTaxSetup,
  keys: readonly string[]
) => {
  const mapped = new Set(keys);
  if (
    mapped.size !== keys.length ||
    mapped.size !== setup.classes.length ||
    setup.classes.some(({ key }) => !mapped.has(key))
  ) {
    throw new Error(
      "Supply exactly one provider tax mapping for each declared Tax Class."
    );
  }
};
