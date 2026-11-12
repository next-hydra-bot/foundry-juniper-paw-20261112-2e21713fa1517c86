// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";

import { catalogJsonSchema, decodeCatalog } from "./model";
import { decodeProductModel, productModelJsonSchema } from "./product-model";

const inputModel = () => ({
  defaultLocale: "en-US",
  productTypes: [
    {
      attributes: [
        {
          key: "roast",
          type: "enum",
          required: true,
          labels: { "en-US": "Roast" },
          values: [
            {
              key: "dark-roast",
              labels: { "en-US": "Dark", "fr-FR": "Foncé" },
            },
          ],
        },
        {
          key: "grams",
          type: "integer",
          required: true,
          labels: { "en-US": "Weight" },
          minimum: 1,
          maximum: 1000,
        },
        {
          key: "notes",
          type: "text",
          list: true,
          required: false,
          labels: { "en-US": "Tasting notes" },
          minLength: 2,
        },
        {
          key: "accessory",
          type: "product-reference",
          required: false,
          labels: { "en-US": "Accessory" },
        },
      ],
      description: "Coffee beans",
      key: "coffee",
      labels: { "en-US": "Coffee" },
      searchFacets: ["grams", "notes", "roast"],
      variantOptions: ["roast"],
    },
  ],
  schemaVersion: 1,
});
const inputCatalog = () => ({
  categories: [],
  defaultLocale: "en-US",
  products: [
    {
      categoryKeys: [],
      description: "Roasted beans",
      key: "coffee-beans",
      options: [
        {
          key: "roast",
          label: "Roast",
          values: [{ key: "dark-roast", label: "Dark" }],
        },
      ],
      productType: "coffee",
      relatedProductKeys: [],
      title: "Coffee beans",
      translations: {},
      variants: [
        {
          sku: "BEANS-DARK",
          attributes: {
            roast: { key: "dark-roast", label: "Dark" },
            grams: 250,
            notes: ["Cocoa", "Nuts"],
          },
          optionValues: { roast: "dark-roast" },
          images: [],
          quantity: 5,
          price: { regular: { centAmount: 1299, currencyCode: "USD" } },
        },
      ],
    },
  ],
});

describe("agent-authored product models", () => {
  it("validates new attributes and generates catalog tool schemas without hardcoded product types", () => {
    const model = decodeProductModel(inputModel());
    expect(decodeCatalog(inputCatalog(), model).products[0]?.productType).toBe(
      "coffee"
    );
    expect(JSON.stringify(catalogJsonSchema(model))).toContain("dark-roast");
    expect(JSON.stringify(productModelJsonSchema())).toContain(
      "product-reference"
    );
    expect(model.productTypes[0]?.searchFacets).toEqual([
      "grams",
      "notes",
      "roast",
    ]);
    expect(JSON.stringify(productModelJsonSchema())).toContain("searchFacets");
  });

  it.each([
    { searchFacets: ["missing"] },
    { searchFacets: ["grams", "grams"] },
    { searchFacets: ["accessory"] },
  ])(
    "rejects invalid search facet selection $searchFacets",
    ({ searchFacets }) => {
      const input = inputModel();
      expect(() =>
        decodeProductModel({
          ...input,
          productTypes: input.productTypes.map((type) => ({
            ...type,
            searchFacets,
          })),
        })
      ).toThrow(/search facet/u);
    }
  );

  it.each([0, 1001, 1.5, "250"])(
    "rejects invalid integer weight %s",
    (grams) => {
      const catalog = inputCatalog();
      expect(() =>
        decodeCatalog(
          {
            ...catalog,
            products: catalog.products.map((product) => ({
              ...product,
              variants: product.variants.map((variant) => ({
                ...variant,
                attributes: { ...variant.attributes, grams },
              })),
            })),
          },
          decodeProductModel(inputModel())
        )
      ).toThrow(/./u);
    }
  );

  it("rejects unknown fields, invalid enum keys and invalid list items", () => {
    const catalog = inputCatalog();
    for (const attributes of [
      { grams: 250, roast: { key: "invented", label: "Dark" } },
      {
        grams: 250,
        invented: true,
        roast: { key: "dark-roast", label: "Dark" },
      },
      { grams: 250, notes: ["x"], roast: { key: "dark-roast", label: "Dark" } },
    ]) {
      expect(() =>
        decodeCatalog(
          {
            ...catalog,
            products: catalog.products.map((product) => ({
              ...product,
              variants: product.variants.map((variant) => ({
                ...variant,
                attributes,
              })),
            })),
          },
          decodeProductModel(inputModel())
        )
      ).toThrow(/./u);
    }
  });

  it("rejects dangling custom product references", () => {
    const catalog = inputCatalog();
    expect(() =>
      decodeCatalog(
        {
          ...catalog,
          products: catalog.products.map((product) => ({
            ...product,
            variants: product.variants.map((variant) => ({
              ...variant,
              attributes: { ...variant.attributes, accessory: "missing" },
            })),
          })),
        },
        decodeProductModel(inputModel())
      )
    ).toThrow(/Missing related/u);
  });

  it("rejects invalid model definitions before generation", () => {
    const input = inputModel();
    const [type] = input.productTypes;
    expect(() =>
      decodeProductModel({
        ...input,
        productTypes: [
          { ...type, key: "product" },
          { ...type, key: "catalog-product" },
        ],
      })
    ).toThrow(/Duplicate Product Type identity/u);
    expect(() =>
      decodeProductModel({ ...input, productTypes: [type, type] })
    ).toThrow(/Duplicate/u);
    expect(() =>
      decodeProductModel({
        ...input,
        productTypes: [{ ...type, variantOptions: ["missing"] }],
      })
    ).toThrow(/Invalid variant option/u);
    expect(() =>
      decodeProductModel({
        ...input,
        productTypes: [
          {
            ...type,
            attributes: [
              {
                key: "mode",
                labels: { "en-US": "Mode" },
                required: true,
                type: "enum",
              },
            ],
          },
        ],
      })
    ).toThrow(/Enum requires values/u);
  });
});
