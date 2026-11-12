import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@repo/commerce-core/catalog/files";

import { bindProductOptions } from "./options";

describe("Shopify native option bindings", () => {
  it("joins option positions and variant SKUs to native IDs without any display labels", () => {
    const product = loadCatalog("b2b").products.find(
      ({ key }) => key === "equipment-mobile-lift"
    );
    if (product === undefined) {
      throw new Error("Missing fixture");
    }
    const native = {
      options: [
        {
          id: "color-id",
          optionValues: [{ id: "blue-id" }, { id: "red-id" }],
          position: 1,
        },
      ],
      variants: {
        nodes: product.variants.map((variant) => ({
          selectedOptions: [
            {
              optionValue: {
                id: variant.optionValues.color === "RED" ? "red-id" : "blue-id",
              },
            },
          ],
          sku: variant.sku,
        })),
        pageInfo: { hasNextPage: false },
      },
    };
    expect(bindProductOptions(product, native)).toEqual({
      color: {
        id: "color-id",
        values: { BLUE: "blue-id", RED: "red-id" },
      },
    });
    expect(() =>
      bindProductOptions(product, { ...native, options: [] })
    ).toThrow(/Missing imported option position/u);
    expect(() =>
      bindProductOptions(product, {
        ...native,
        variants: { ...native.variants, pageInfo: { hasNextPage: true } },
      })
    ).toThrow(/variant page/u);
  });
});
