// @vitest-environment node

import { describe, expect, it } from "@effect/vitest";

import { loadCatalog } from "./files";
import { catalogJsonSchema, decodeCatalog } from "./model";

const jacket = () => loadCatalog("b2c").products[0];
const input = (products: readonly object[]) => ({
  ...loadCatalog("b2c"),
  products,
});

describe("domain catalog input", () => {
  it.each(["b2b", "b2c"] as const)("validates the %s JSON source", (name) => {
    const catalog = loadCatalog(name);
    expect(catalog.products).toHaveLength(4);
    expect(decodeCatalog(catalog)).toEqual(catalog);
  });

  it("exports a provider-neutral JSON Schema for generated tool inputs", () => {
    const schema = catalogJsonSchema();
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(JSON.stringify(schema)).toContain("outdoor-product");
    expect(JSON.stringify(schema)).not.toContain("shopify");
  });

  it("rejects provider fields and untyped product attributes", () => {
    expect(() =>
      decodeCatalog(input([{ ...jacket(), shopifyId: "123" }]))
    ).toThrow(/./u);
    const product = jacket();
    expect(() =>
      decodeCatalog(
        input([
          {
            ...product,
            relatedProductKeys: [],
            variants: [{ ...product.variants[0], attributes: { material: 5 } }],
          },
        ])
      )
    ).toThrow(/./u);
  });

  it("rejects duplicate identities and dangling references", () => {
    expect(() => decodeCatalog(input([jacket(), jacket()]))).toThrow(
      /Duplicate/u
    );
    expect(() => decodeCatalog(input([jacket()]))).toThrow(/Missing related/u);
  });

  it("rejects category references, duplicate categories and invalid locale keys", () => {
    const catalog = loadCatalog("b2c");
    expect(() => decodeCatalog({ ...catalog, categories: [] })).toThrow(
      /Missing catalog category/u
    );
    expect(() =>
      decodeCatalog({
        ...catalog,
        categories: [catalog.categories[0], catalog.categories[0]],
      })
    ).toThrow(/Duplicate/u);
    expect(() =>
      decodeCatalog(
        input([
          {
            ...jacket(),
            translations: {
              xx: { description: "Description", title: "Title" },
            },
          },
        ])
      )
    ).toThrow(/./u);
    expect(() =>
      decodeCatalog(
        input([
          {
            ...jacket(),
            translations: {
              "en-US": { description: "Description", title: "Title" },
            },
          },
        ])
      )
    ).toThrow(/Default locale/u);
  });

  it("rejects duplicate or inconsistent shared image metadata and non-HTTP URLs", () => {
    const product = jacket();
    const [variant] = product.variants;
    const [image] = variant.images;
    expect(() =>
      decodeCatalog(
        input([
          { ...product, variants: [{ ...variant, images: [image, image] }] },
        ])
      )
    ).toThrow(/Duplicate variant image/u);
    expect(() =>
      decodeCatalog(
        input([
          {
            ...product,
            variants: [
              {
                ...variant,
                images: [{ ...image, url: "file:///private/image.png" }],
              },
            ],
          },
        ])
      )
    ).toThrow(/./u);
    expect(() =>
      decodeCatalog(
        input([
          {
            ...product,
            variants: [{ ...variant, images: [{ ...image, width: 0 }] }],
          },
        ])
      )
    ).toThrow(/./u);
  });

  it("rejects option choices that contradict typed attributes", () => {
    const product = jacket();
    expect(() =>
      decodeCatalog(
        input([
          {
            ...product,
            relatedProductKeys: [],
            variants: [
              {
                ...product.variants[0],
                optionValues: { color: "RED", size: "L" },
              },
            ],
          },
        ])
      )
    ).toThrow(/options/u);
  });

  it.each([
    { regular: { centAmount: -1, currencyCode: "USD" } },
    { regular: { centAmount: 1.5, currencyCode: "USD" } },
    {
      discounted: { centAmount: 100, currencyCode: "USD" },
      regular: { centAmount: 100, currencyCode: "USD" },
    },
    {
      discounted: { centAmount: 50, currencyCode: "EUR" },
      regular: { centAmount: 100, currencyCode: "USD" },
    },
  ])("rejects invalid prices: %j", (price) => {
    const product = jacket();
    expect(() =>
      decodeCatalog(
        input([
          {
            ...product,
            relatedProductKeys: [],
            variants: [{ ...product.variants[0], price }],
          },
        ])
      )
    ).toThrow(/./u);
  });
});
