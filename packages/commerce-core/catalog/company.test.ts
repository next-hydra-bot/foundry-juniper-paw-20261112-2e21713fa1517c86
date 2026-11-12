// @vitest-environment node

import { SellingCatalog } from "@repo/commerce-core/catalog/selling";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CompanyCatalogAssignments, companyCatalogPlans } from "./company";
import { loadCompanyCatalogSetup } from "./files";

const setup = loadCompanyCatalogSetup({
  assignmentsFile: new URL(
    "../../commerce-b2b/catalog/assignments.json",
    import.meta.url
  ),
});
const assignments = Schema.decodeUnknownSync(CompanyCatalogAssignments)({
  assignments: setup.plans.map(({ assignment }) => assignment),
});

describe("company catalog assignments", () => {
  it("resolves companies and their child Business Units against shared product and selling sources", () => {
    expect(
      setup.plans.map(({ assignment, products }) => [
        assignment.businessUnitKey,
        products.length,
      ])
    ).toEqual([
      ["earthworks", 2],
      ["earthworks-service", 2],
      ["earthworks-parts", 2],
      ["warehouse", 3],
      ["france", 3],
    ]);
    const [earthworks, service, parts, warehouse, france] = setup.plans;
    expect({ parts, service }).toMatchObject({
      parts: {
        assortment: earthworks?.assortment,
        priceList: warehouse?.priceList,
        store: earthworks?.store,
      },
      service: { priceList: earthworks?.priceList },
    });
    expect(france).toMatchObject({
      pricingGroup: warehouse?.pricingGroup,
      store: {
        currency: "EUR",
        locale: "fr-FR",
        storeKey: "france-store",
      },
    });
    expect(
      [earthworks, parts, france].map(
        (plan) =>
          plan?.priceList.prices.find(({ sku }) => sku === "ATTACH-STD")
            ?.centAmount
      )
    ).toEqual([15_000, 16_500, 14_500]);
    expect(
      earthworks?.products.find(
        ({ key }) => key === "equipment-replacement-attachment"
      )
    ).toBe(
      warehouse?.products.find(
        ({ key }) => key === "equipment-replacement-attachment"
      )
    );
  });

  it("shares company pricing across independently configured Store assortments", () => {
    const shared = companyCatalogPlans(
      Schema.decodeUnknownSync(CompanyCatalogAssignments)({
        assignments: assignments.assignments
          .filter(({ locale }) => locale === "en-US")
          .map((assignment) => ({
            ...assignment,
            pricingGroupKey: "gold-dealers",
          })),
      }),
      setup.selling,
      setup.catalogs
    );
    expect(shared[0]?.priceList).toBe(shared[3]?.priceList);
    expect(shared.map(({ products }) => products.length)).toEqual([2, 2, 2, 3]);
  });

  it("validates fixed prices against the public Store assortment", () => {
    expect(() =>
      companyCatalogPlans(
        assignments,
        Schema.decodeUnknownSync(SellingCatalog)({
          ...setup.selling,
          priceLists: setup.selling.priceLists.map((list) => ({
            ...list,
            prices: list.prices.filter(({ sku }) => sku !== "ATTACH-STD"),
          })),
        }),
        setup.catalogs
      )
    ).toThrow("Missing fixed price");
  });

  it("rejects ambiguous buyer assignments and Store/currency mismatches", () => {
    expect(() =>
      companyCatalogPlans(
        Schema.decodeUnknownSync(CompanyCatalogAssignments)({
          assignments: [...assignments.assignments, ...assignments.assignments],
        }),
        setup.selling,
        setup.catalogs
      )
    ).toThrow("Ambiguous company catalog");
    expect(() =>
      companyCatalogPlans(
        assignments,
        Schema.decodeUnknownSync(SellingCatalog)({
          ...setup.selling,
          stores: setup.selling.stores.map((store) => ({
            ...store,
            currency: "EUR",
          })),
        }),
        setup.catalogs
      )
    ).toThrow("Invalid Store");
  });
});
