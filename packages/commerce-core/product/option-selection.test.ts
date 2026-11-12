import { describe, expect, it } from "vitest";

import {
  productSelectionQuery,
  resolveProductOptions,
  resolveProductSelection,
  writeProductSelection,
} from "./option-selection";

const product = {
  defaultVariantId: "opaque:black-small",
  options: [
    {
      key: "size",
      values: [
        { key: "S", id: "value:small" },
        { key: "L", id: "value:large" },
      ],
    },
    {
      key: "color",
      values: [
        { key: "black", id: "value:black" },
        { key: "blue", id: "value:blue" },
      ],
    },
  ],
  variants: [
    {
      id: "opaque:black-small",
      optionValues: { size: "S", color: "black" },
      isInStock: true,
    },
    {
      id: "opaque:blue-small",
      optionValues: { size: "S", color: "blue" },
      isInStock: false,
    },
    {
      id: "opaque:blue-large",
      optionValues: { size: "L", color: "blue" },
      isInStock: true,
    },
  ],
};

describe("Product option selection", () => {
  it("completes a partial option link from compatible variants", () => {
    expect(resolveProductSelection(product, { "option.size": "L" })).toEqual({
      optionValues: { size: "L", color: "blue" },
      variantId: "opaque:blue-large",
    });
  });

  it("gives an exact opaque variant precedence over conflicting option parameters", () => {
    expect(
      resolveProductSelection(product, {
        variant: "opaque:blue-small",
        "option.color": "black",
      })
    ).toEqual({
      optionValues: { size: "S", color: "blue" },
      variantId: "opaque:blue-small",
    });
  });

  it("retains a missing combination without selecting unrelated merchandise", () => {
    expect(
      resolveProductOptions(product, { color: "black", size: "L" })
    ).toEqual({ optionValues: { color: "black", size: "L" } });
  });

  it("matches opaque option-value IDs without using translated labels", () => {
    expect(
      resolveProductSelection(product, {
        option_values: "value:large,value:blue",
      }).variantId
    ).toBe("opaque:blue-large");
  });

  it.each([
    { "option.size": "Large" },
    { "option.unknown": "value" },
    { "option.size": ["S", "L"] },
    { option_values: "value:large,value:missing" },
    { option_values: "value:small,value:large" },
  ])("does not resolve invalid selection input: %j", (query) => {
    expect(resolveProductSelection(product, query)).toMatchObject({
      invalidInput: true,
    });
    expect(resolveProductSelection(product, query).variantId).toBeUndefined();
  });

  it("writes only selection parameters while preserving locale path, tracking, repeated parameters and hash", () => {
    const url = new URL(
      "https://store.example/fr-FR/products/jacket?variant=old&option_values=old&option.color=black&country=FR&tag=a&tag=b#details"
    );
    const href = writeProductSelection(
      url,
      product,
      resolveProductSelection(product, { "option.size": "L" })
    );
    const result = new URL(href, url);
    expect({
      path: result.pathname,
      hash: result.hash,
      query: productSelectionQuery(result.searchParams),
    }).toEqual({
      path: "/fr-FR/products/jacket",
      hash: "#details",
      query: {
        "option.size": "L",
        "option.color": "blue",
        country: "FR",
        tag: ["a", "b"],
      },
    });
  });
});
