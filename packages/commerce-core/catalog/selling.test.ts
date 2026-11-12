// @vitest-environment node

import { describe, expect, it } from "vitest";

import { loadCatalogSources, loadSellingCatalog } from "./files";
import { decodeSellingCatalog, sellingCatalogJsonSchema } from "./selling";

const catalogs = loadCatalogSources();
const fixture = loadSellingCatalog(catalogs);

describe("selling catalog JSON", () => {
  it("reuses the heavy machinery source with overlapping assortments and independent fixed prices", () => {
    expect(fixture.sourceCatalog).toBe("b2b");
    expect(fixture.assortments.map(({ productKeys }) => productKeys)).toEqual([
      ["equipment-compact-excavator", "equipment-replacement-attachment"],
      [
        "equipment-mobile-lift",
        "equipment-pallet-truck",
        "equipment-replacement-attachment",
      ],
    ]);
    expect(
      fixture.priceLists.map(
        ({ prices }) =>
          prices.find(({ sku }) => sku === "ATTACH-STD")?.centAmount
      )
    ).toEqual([15_000, 16_500, 14_500]);
    expect(sellingCatalogJsonSchema().$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema"
    );
  });

  it("rejects unknown products, SKUs and duplicate price identities", () => {
    expect(() =>
      decodeSellingCatalog(
        { ...fixture, assortments: [{ key: "bad", productKeys: ["missing"] }] },
        catalogs
      )
    ).toThrow("unknown assortment/product");
    expect(() =>
      decodeSellingCatalog(
        {
          ...fixture,
          priceLists: [
            {
              currency: "USD",
              key: "bad",
              prices: [{ centAmount: 1, sku: "missing" }],
            },
          ],
        },
        catalogs
      )
    ).toThrow("unknown price list/SKU");
    expect(() =>
      decodeSellingCatalog(
        {
          ...fixture,
          priceLists: [...fixture.priceLists, ...fixture.priceLists],
        },
        catalogs
      )
    ).toThrow("unknown price list/SKU");
  });

  it("does not infer a Store currency from its locale", () => {
    const configured = decodeSellingCatalog(
      {
        ...fixture,
        stores: fixture.stores.map((store) => ({ ...store, currency: "NZD" })),
      },
      catalogs
    );
    expect(configured.stores[0]?.locale).toBe("en-US");
    expect(configured.stores[0]?.currency).toBe("NZD");
  });
});
