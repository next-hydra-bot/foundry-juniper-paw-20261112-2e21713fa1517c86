import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { Catalog } from "./model";
import {
  CatalogTaxSetup,
  validateCatalogTaxSetup,
  validateTaxClassMappings,
} from "./tax";

const catalogs = {
  test: {
    categories: [],
    defaultLocale: "en-US",
    products: [
      {
        key: "bottle",
        title: "Bottle",
        description: "",
        categoryKeys: [],
        relatedProductKeys: [],
        translations: {},
        productType: "goods",
        options: [],
        variants: [
          {
            sku: "bottle-1",
            attributes: {},
            images: [],
            optionValues: {},
            quantity: 1,
            price: { regular: { currencyCode: "USD", centAmount: 100 } },
          },
        ],
      },
    ],
  },
} satisfies Readonly<Record<string, Catalog>>;
const input = {
  classes: [{ key: "standard", name: "Goods" }],
  products: [{ productKey: "bottle", taxClassKey: "standard" }],
};
const decode = Schema.decodeUnknownSync(CatalogTaxSetup);

describe("Catalog tax assignments", () => {
  it("requires explicit complete assignments and exact class mappings", () => {
    const setup = decode(input);
    expect(() => {
      validateCatalogTaxSetup(setup, catalogs);
    }).not.toThrow(/Tax Class|tax assignment/u);
    expect(() => {
      validateTaxClassMappings(setup, ["standard"]);
    }).not.toThrow(/Tax Class|tax assignment/u);
    expect(() => {
      validateTaxClassMappings(setup, []);
    }).toThrow("exactly one");
    expect(() => {
      validateTaxClassMappings(setup, ["standard", "standard"]);
    }).toThrow("exactly one");
    expect(() => {
      validateCatalogTaxSetup(setup, {
        ...catalogs,
        other: {
          ...catalogs.test,
          products: [{ ...catalogs.test.products[0], key: "pack" }],
        },
      });
    }).toThrow("every imported Product");
  });

  it.each([
    { classes: [input.classes[0], input.classes[0]] },
    { products: [{ productKey: "unknown", taxClassKey: "standard" }] },
    { products: [{ productKey: "bottle", taxClassKey: "unknown" }] },
    { products: [input.products[0], input.products[0]] },
  ])("rejects conflicting source references: %j", (change) => {
    expect(() => {
      validateCatalogTaxSetup(decode({ ...input, ...change }), catalogs);
    }).toThrow(/Tax Class|tax assignment/u);
  });
});
