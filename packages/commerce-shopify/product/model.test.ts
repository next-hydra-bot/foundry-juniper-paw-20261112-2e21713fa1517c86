// @vitest-environment node
import { describe, expect, it } from "@effect/vitest";
import { decodeProductModel } from "@repo/commerce-core/catalog/product-model";

import { toMetafields } from "../catalog/mapping";
import { readAttributes } from "./attributes";
import { modelMetafields } from "./model";
import { readOptionLabels, readOptionSelections } from "./options";

const model = decodeProductModel({
  defaultLocale: "en-US",
  productTypes: [
    {
      attributes: [
        {
          key: "roast",
          labels: { "en-US": "Roast", "fr-FR": "Torréfaction" },
          required: true,
          type: "enum",
          values: [
            {
              key: "dark-roast",
              labels: { "en-US": "Dark", "fr-FR": "Foncé" },
            },
          ],
        },
        {
          key: "grams",
          labels: { "en-US": "Weight" },
          minimum: 1,
          required: true,
          type: "integer",
        },
        {
          key: "notes",
          labels: { "en-US": "Notes" },
          list: true,
          required: false,
          type: "text",
        },
      ],
      description: "Beans",
      key: "coffee",
      labels: { "en-US": "Coffee" },
      variantOptions: ["roast"],
    },
  ],
  schemaVersion: 1,
});

const bindings = {
  roast: { id: "roast-id", values: { "dark-roast": "dark-id" } },
};
const nativeOptions = (name: string, value: string) => [
  {
    id: "roast-id",
    name,
    optionValues: [{ id: "dark-id", name: value }],
  },
];

describe("Shopify custom product models", () => {
  it("uses native translated strings with the stable enum key", () => {
    const attributes = {
      grams: 250,
      notes: ["Cocoa", "Nuts"],
      roast: { key: "dark-roast", label: "Dark" },
    };
    const fields = toMetafields(attributes, "coffee", model);
    const english = readOptionLabels(nativeOptions("Roast", "Dark"), bindings);
    expect(readAttributes("coffee", [], fields, english, model)).toEqual(
      attributes
    );
    const french = readOptionLabels(
      nativeOptions("Torréfaction du café", "Corsé"),
      bindings
    );
    const translated = readAttributes("coffee", [], fields, french, model);
    // These strings deliberately differ from Core's French labels: Shopify owns display content.
    expect(translated.roast).toEqual({ key: "dark-roast", label: "Corsé" });
    expect(readOptionSelections("coffee", translated, french, model)).toEqual([
      {
        key: "roast",
        label: "Torréfaction du café",
        value: { key: "dark-roast", label: "Corsé" },
      },
    ]);
    expect(() =>
      readAttributes(
        "coffee",
        [],
        fields.map((field) =>
          field.key === "grams" ? { ...field, value: "0" } : field
        ),
        english,
        model
      )
    ).toThrow(/./u);
  });

  it("does not compare labels across languages or reject retained Shopify translations", () => {
    const collision = decodeProductModel({
      ...model,
      productTypes: model.productTypes.map((type) => ({
        ...type,
        attributes: type.attributes.map((attribute) =>
          attribute.key === "roast"
            ? {
                ...attribute,
                values: [
                  {
                    key: "dark-roast",
                    labels: { "en-US": "Dark", "fr-FR": "Foncé" },
                  },
                  {
                    key: "light-roast",
                    labels: { "en-US": "Foncé", "fr-FR": "Clair" },
                  },
                ],
              }
            : attribute
        ),
      })),
    });
    const native = [
      {
        id: "roast-id",
        name: "Roast",
        optionValues: [
          { id: "dark-id", name: "Dark" },
          { id: "light-id", name: "Foncé" },
        ],
      },
    ];
    const labels = readOptionLabels(native, {
      roast: {
        id: "roast-id",
        values: { "dark-roast": "dark-id", "light-roast": "light-id" },
      },
    });
    const fields = toMetafields(
      { grams: 250, roast: { key: "light-roast", label: "Foncé" } },
      "coffee",
      collision
    );
    expect(
      readAttributes("coffee", [], fields, labels, collision).roast
    ).toEqual({ key: "light-roast", label: "Foncé" });
    const retained = readOptionLabels(
      nativeOptions("Ancien nom", "Ancienne traduction"),
      bindings
    );
    const original = toMetafields(
      { grams: 250, roast: { key: "dark-roast", label: "Dark" } },
      "coffee",
      model
    );
    expect(
      readAttributes("coffee", [], original, retained, model).roast
    ).toEqual({ key: "dark-roast", label: "Ancienne traduction" });
  });

  it("requires IDs and stored keys instead of recovering identity from labels", () => {
    const fields = toMetafields(
      { grams: 250, roast: { key: "dark-roast", label: "Dark" } },
      "coffee",
      model
    );
    expect(() => readAttributes("coffee", [], fields, {}, model)).toThrow(
      /Missing Shopify option binding/u
    );
    expect(() =>
      readOptionLabels(nativeOptions("Roast", "Dark"), {
        roast: { id: "other-id", values: {} },
      })
    ).toThrow(/Missing bound Shopify option/u);
    const labels = readOptionLabels(nativeOptions("Roast", "Dark"), bindings);
    expect(() =>
      readAttributes(
        "coffee",
        [],
        fields.filter(({ key }) => key !== "roast"),
        labels,
        model
      )
    ).toThrow(/./u);
  });

  it("rejects incompatible shared field types before provisioning", () => {
    const extended = decodeProductModel({
      ...model,
      productTypes: [
        ...model.productTypes,
        {
          attributes: [
            {
              key: "grams",
              labels: { "en-US": "Weight label" },
              required: false,
              type: "text",
            },
          ],
          description: "Machine",
          key: "machine",
          labels: { "en-US": "Machine" },
          variantOptions: [],
        },
      ],
    });
    expect(() => modelMetafields(extended)).toThrow(/incompatible types/u);
  });
});
