import { describe, expect, it } from "vitest";

import { catalogChangeTags, catalogTags } from "./cache-tags";

describe("Catalog cache dependencies", () => {
  it("invalidates a changed product, lists and negative lookups across selling contexts", () => {
    const tags = catalogChangeTags({
      id: "opaque-product-id",
      kind: "product",
    });
    expect(tags).toContain(catalogTags.product("opaque-product-id"));
    expect(tags).toContain(catalogTags.productLists);
    expect(tags).toContain(catalogTags.productLookups);
    expect(tags).not.toContain(catalogTags.product("another-product"));
    expect(tags).not.toContain(catalogTags.products);
  });

  it("refreshes embedded category metadata and inventory dependencies", () => {
    for (const kind of ["category", "catalog"] as const) {
      expect(catalogChangeTags({ kind })).toEqual(
        expect.arrayContaining([
          catalogTags.products,
          catalogTags.categories,
          catalogTags.productLists,
          catalogTags.productLookups,
        ])
      );
    }
  });

  it("supports arbitrary opaque IDs within Next's tag length limit", () => {
    expect(catalogTags.product("id".repeat(400)).length).toBeLessThan(256);
    expect(catalogTags.product("one")).not.toBe(catalogTags.product("two"));
  });
});
