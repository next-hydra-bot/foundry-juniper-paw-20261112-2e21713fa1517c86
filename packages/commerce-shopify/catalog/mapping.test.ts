import { describe, expect, it } from "@effect/vitest";
import { catalogByName } from "@repo/commerce-core/catalog/files";

import {
  shopifyCatalogReaders,
  shopifyMoney,
  catalogTranslationLocales,
  productOptionTranslations,
} from "./mapping";

const loadCatalog = (name: string) =>
  catalogByName(shopifyCatalogReaders(), name)();

describe("Shopify option translation mapping", () => {
  it("uses only this catalog's languages and the enum values present on the product", () => {
    const catalog = loadCatalog("b2b");
    const product = catalog.products.find(
      ({ key }) => key === "equipment-mobile-lift"
    );
    if (product === undefined) {
      throw new Error("Missing fixture");
    }
    const [french] = catalogTranslationLocales(catalog);
    expect(french).toMatch(/^fr-(CA|FR)$/u);
    expect(catalogTranslationLocales(catalog)).toEqual([french]);
    expect(
      productOptionTranslations(product, catalogTranslationLocales(catalog))
    ).toEqual([
      {
        key: "color",
        name: "Color",
        translations: { [french!]: { name: "Couleur" } },
        values: [
          {
            key: "RED",
            name: "Red",
            translations: { [french!]: { name: "Rouge" } },
          },
          {
            key: "BLUE",
            name: "Blue",
            translations: { [french!]: { name: "Bleu" } },
          },
        ],
      },
    ]);
    expect(productOptionTranslations(product, [])).toEqual([
      {
        key: "color",
        name: "Color",
        translations: {},
        values: [
          { key: "RED", name: "Red", translations: {} },
          { key: "BLUE", name: "Blue", translations: {} },
        ],
      },
    ]);
  });

  it("translates numeric option names without changing their values and skips synthetic options", () => {
    const catalog = loadCatalog("b2b");
    const excavator = catalog.products.find(
      ({ key }) => key === "equipment-compact-excavator"
    );
    const attachment = catalog.products.find(
      ({ key }) => key === "equipment-replacement-attachment"
    );
    if (excavator === undefined || attachment === undefined) {
      throw new Error("Missing fixture");
    }
    expect(productOptionTranslations(excavator, ["fr-FR"])).toEqual([
      {
        key: "model",
        name: "Model",
        translations: { "fr-FR": { name: "Modèle" } },
        values: [
          { key: "180", name: "180", translations: {} },
          { key: "250", name: "250", translations: {} },
        ],
      },
    ]);
    expect(productOptionTranslations(attachment, ["fr-FR"])).toEqual([]);
  });
});

describe("catalog currency encoding", () => {
  it("formats exact minor units for two-, zero- and three-decimal currencies", () => {
    expect(shopifyMoney({ centAmount: 12_345, currencyCode: "EUR" })).toBe(
      "123.45"
    );
    expect(shopifyMoney({ centAmount: 12_345, currencyCode: "JPY" })).toBe(
      "12345"
    );
    expect(shopifyMoney({ centAmount: 12_345, currencyCode: "KWD" })).toBe(
      "12.345"
    );
  });
});
