import { describe, expect, it } from "vitest";

import { withShopifyProductSearchParams } from "./search-params";

describe(withShopifyProductSearchParams, () => {
  it("normalizes native option-value IDs without changing stable option queries", async () => {
    await expect(
      withShopifyProductSearchParams(
        Promise.resolve({
          option_values: "123,456",
          "option.size": "L",
          country: "US",
        })
      )
    ).resolves.toEqual({
      option_values:
        "gid://shopify/ProductOptionValue/123,gid://shopify/ProductOptionValue/456",
      "option.size": "L",
      country: "US",
    });
  });

  it("resolves a native variant reference while preserving the other query parameters", async () => {
    const query = {
      country: "US",
      tag: ["a", "b"],
      utm_source: "orders",
      variant: "45236613513267",
    };
    await expect(
      withShopifyProductSearchParams(Promise.resolve(query))
    ).resolves.toEqual({
      ...query,
      variant: "gid://shopify/ProductVariant/45236613513267",
    });
    expect(query.variant).toBe("45236613513267");
  });

  it.each([
    undefined,
    "invalid",
    "gid://shopify/ProductVariant/42",
    ["1", "2"],
  ])(
    "preserves an absent, opaque or ambiguous reference: %s",
    async (variant) => {
      const query = { variant };
      await expect(
        withShopifyProductSearchParams(Promise.resolve(query))
      ).resolves.toBe(query);
    }
  );
});
