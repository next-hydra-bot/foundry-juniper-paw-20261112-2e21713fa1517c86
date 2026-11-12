import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { ProductTypeKey } from "@repo/commerce-core/product/generated/attributes";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
  Store,
} from "@repo/commerce-core/store";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  toMetafields,
  shopifyMoney,
  variantOptions,
  productOptionTranslations,
} from "../catalog/mapping";
import { catalogOptionsFixture } from "../testing/options";
import { optionSummary, readAttributes, readProductType } from "./attributes";
import { mapProductDetail } from "./mapping";

const store = resolveStore(
  { locale: CommerceLocale.make("en-US") },
  storeConfiguration
);
const frenchStore = new Store({
  currency: store.currency,
  locale: CommerceLocale.make("fr-FR"),
  storeKey: store.storeKey,
});
const outdoor = Schema.decodeUnknownSync(ProductTypeKey)("outdoor-product");

describe("Shopify typed catalog attributes", () => {
  it.each(["b2b", "b2c"] as const)(
    "round-trips the shared %s domain catalog through Shopify mapping",
    (catalog) => {
      for (const source of loadCatalog(catalog).products) {
        const metafields = [
          {
            key: "productType",
            type: "single_line_text_field",
            value: source.productType,
          },
        ];
        const variants = source.variants.map((variant) => ({
          availableForSale: variant.quantity > 0,
          compareAtPrice:
            variant.price.discounted === undefined
              ? null
              : {
                  amount: shopifyMoney(variant.price.regular),
                  currencyCode: "USD",
                },
          currentlyNotInStock: false,
          gallery: {
            references: {
              nodes: variant.images.map(({ url, altText }) => ({
                __typename: "MediaImage" as const,
                image: { altText: altText ?? null, url },
              })),
              pageInfo: { hasNextPage: false },
            },
          },
          id: variant.sku,
          image: null,
          metafields: toMetafields(variant.attributes),
          price: {
            amount: shopifyMoney(
              variant.price.discounted ?? variant.price.regular
            ),
            currencyCode: "USD",
          },
          quantityAvailable: variant.quantity,
          selectedOptions: variantOptions(source, variant).map(
            ({ optionName, name }) => ({ name: optionName, value: name })
          ),
          sku: variant.sku,
        }));
        const result = mapProductDetail(
          {
            collections: {
              nodes: source.categoryKeys.map((key) => {
                const category = loadCatalog(catalog).categories.find(
                  (item) => item.key === key
                );
                return {
                  handle: key,
                  id: key,
                  seedCatalog: { value: catalog },
                  seedCategory: { value: key },
                  title: category?.title ?? "",
                };
              }),
              pageInfo: { hasNextPage: false },
            },
            description: source.description,
            featuredImage: null,
            handle: source.key,
            id: source.key,
            metafields,
            title: source.title,
            ...catalogOptionsFixture(source),
            variants: {
              nodes: variants,
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
          variants,
          store
        );
        const french = source.translations["fr-FR"];
        if (french === undefined) {
          throw new Error("Missing translation fixture");
        }
        const labels = productOptionTranslations(source, ["fr-FR"]);
        const translatedVariants = variants.map((variant) => ({
          ...variant,
          selectedOptions: variant.selectedOptions.map((option) => {
            const label = labels.find(({ name }) => name === option.name);
            return {
              name: label?.translations["fr-FR"]?.name ?? option.name,
              value:
                label?.values.find(({ name }) => name === option.value)
                  ?.translations["fr-FR"]?.name ?? option.value,
            };
          }),
        }));
        const translated = mapProductDetail(
          {
            collections: {
              nodes: source.categoryKeys.map((key) => ({
                handle: key,
                id: key,
                seedCatalog: { value: catalog },
                seedCategory: { value: key },
                title:
                  loadCatalog(catalog).categories.find(
                    (category) => category.key === key
                  )?.translations["fr-FR"]?.title ?? "",
              })),
              pageInfo: { hasNextPage: false },
            },
            description: french.description,
            featuredImage: null,
            handle: source.key,
            id: source.key,
            metafields,
            title: french.title,
            ...catalogOptionsFixture(source, "fr-FR"),
            variants: {
              nodes: translatedVariants,
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
          translatedVariants,
          frenchStore
        );
        expect(
          translated.options.map(({ key, values }) => ({
            key,
            values: values.map(({ key: valueKey }) => valueKey),
          }))
        ).toEqual(
          source.options.map(({ key, values }) => ({
            key,
            values: values.map(({ key: valueKey }) => valueKey),
          }))
        );
        for (const option of translated.options) {
          const sourceLabel = labels.find(
            ({ name }) =>
              name ===
              source.options.find(({ key }) => key === option.key)?.label
          );
          expect(option.label).toBe(
            sourceLabel?.translations["fr-FR"]?.name ?? sourceLabel?.name
          );
        }
        expect({
          categories: translated.categories.map(({ name }) => name),
          description: translated.description,
          title: translated.title,
        }).toEqual({
          ...french,
          categories: source.categoryKeys.map(
            (key) =>
              loadCatalog(catalog).categories.find(
                (category) => category.key === key
              )?.translations["fr-FR"]?.title
          ),
        });
        expect(result.options).toMatchObject(source.options);
        expect(result.categories.map(({ id }) => id)).toEqual(
          source.categoryKeys
        );
        expect(
          result.variants.map(
            ({
              sku,
              attributes,
              optionValues,
              price,
              availability,
              images,
            }) => ({
              attributes,
              images,
              optionValues,
              price,
              quantity: availability.availableQuantity,
              sku,
            })
          )
        ).toEqual(
          source.variants.map(({ images, ...variant }) => ({
            ...variant,
            images: images.map(({ url, altText }) =>
              altText === undefined ? { url } : { altText, url }
            ),
          }))
        );
      }
    }
  );

  it("uses variant metafields over product defaults and preserves false, zero and references", () => {
    const attributes = readAttributes(
      outdoor,
      toMetafields({ insulated: true, material: "Nylon", weightGrams: 620 }),
      [
        ...toMetafields({
          insulated: false,
          material: "Nylon",
          weightGrams: 0,
        }),
        {
          key: "relatedProducts",
          type: "list.product_reference",
          value: '["gid://shopify/Product/1"]',
        },
      ],
      {}
    );
    expect(attributes).toEqual({
      insulated: false,
      material: "Nylon",
      relatedProducts: ["gid://shopify/Product/1"],
      weightGrams: 0,
    });
  });

  it("rejects malformed values, missing required attributes and unknown declared product types", () => {
    for (const value of ["NaN", "Infinity", "", "not-a-number"]) {
      expect(() =>
        readAttributes(
          outdoor,
          [{ key: "weightGrams", type: "number_decimal", value }],
          [],
          {}
        )
      ).toThrow(/./u);
    }
    expect(() =>
      readAttributes(
        outdoor,
        [{ key: "material", type: "boolean", value: "true" }],
        [],
        {}
      )
    ).toThrow(/./u);
    expect(() => readAttributes(outdoor, [], [], {})).toThrow(/./u);
    expect(() =>
      readProductType([
        {
          key: "productType",
          type: "single_line_text_field",
          value: "unknown",
        },
      ])
    ).toThrow(/./u);
    expect(readProductType([])).toBe("generic-product");
  });

  it("formats all native variant choices for compact carts and hides Shopify's default option", () => {
    expect(
      optionSummary([
        { name: "Size", value: "M" },
        { name: "Color", value: "Blue" },
      ])
    ).toEqual({ label: "Size / Color", value: "M / Blue" });
    expect(
      optionSummary([{ name: "Title", value: "Default Title" }])
    ).toBeUndefined();
  });
});
