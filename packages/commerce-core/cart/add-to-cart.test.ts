import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { AddToCartInputSchema } from "./add-to-cart";

describe("AddToCartInputSchema", () => {
  it("accepts an opaque variant reference without a product ID or SKU", () => {
    const input = { quantity: 2, variantId: "opaque/purchasable:reference" };

    expect(Schema.decodeUnknownSync(AddToCartInputSchema)(input)).toEqual(
      input
    );
  });

  it("rejects non-positive quantities", () => {
    const result = Schema.decodeUnknownOption(AddToCartInputSchema)({
      quantity: 0,
      variantId: "variant-1",
    });

    expect(result._tag).toBe("None");
  });
});
