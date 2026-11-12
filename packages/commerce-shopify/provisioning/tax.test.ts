import { describe, expect, it } from "@effect/vitest";
import { CatalogTaxSetup } from "@repo/commerce-core/catalog/tax";
import { Effect, Schema } from "effect";

import { makeCatalogAdmin } from "../catalog/admin";
import { applyTaxSetup, ShopifyTaxConfig, validateTaxConfig } from "./tax";

const setup = Schema.decodeUnknownSync(CatalogTaxSetup)({
  classes: [{ key: "goods", name: "Goods" }],
  products: [{ productKey: "bottle", taxClassKey: "goods" }],
});
const config = Schema.decodeUnknownSync(ShopifyTaxConfig)({
  classes: [{ taxClassKey: "goods", taxable: true }],
  expectedShopSettings: { taxShipping: true, taxesIncluded: false },
  productCategories: [],
});

const products = new Map([["bottle", "gid://shopify/Product/1"]]);

const fixture = (
  options: {
    taxesIncluded?: boolean;
    rejectWrite?: boolean;
    missing?: boolean;
    truncated?: boolean;
    taxable?: boolean;
  } = {}
) => {
  let taxable = options.taxable ?? false;
  let category: { id: string } | null = null;
  const writes: { operation: string; variables: Schema.Json }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          query: Schema.String,
          variables: Schema.Record(Schema.String, Schema.Json),
        })
      )
    )(await request.text());
    if (body.query.includes("query TaxSetup")) {
      return Response.json({
        data: {
          shop: {
            taxesIncluded: options.taxesIncluded ?? false,
            taxShipping: true,
          },
        },
      });
    }
    if (body.query.includes("query ProductTaxes")) {
      return Response.json({
        data: {
          product: options.missing
            ? null
            : {
                id: "gid://shopify/Product/1",
                category,
                variants: {
                  nodes: [{ id: "gid://shopify/ProductVariant/2", taxable }],
                  pageInfo: { hasNextPage: options.truncated ?? false },
                },
              },
        },
      });
    }
    const operation = body.query.includes("mutation ProductTaxCategory")
      ? "productUpdate"
      : "productVariantsBulkUpdate";
    writes.push({ operation, variables: body.variables });
    if (options.rejectWrite) {
      return Response.json({
        data: {
          [operation]: {
            userErrors: [{ message: "Native tax write rejected" }],
          },
        },
      });
    }
    if (operation === "productUpdate") {
      const product = Schema.decodeUnknownSync(
        Schema.Struct({ category: Schema.String })
      )(body.variables.product);
      category = { id: product.category };
    } else {
      const variants = Schema.decodeUnknownSync(
        Schema.NonEmptyArray(Schema.Struct({ taxable: Schema.Boolean }))
      )(body.variables.variants);
      [{ taxable }] = variants;
    }
    return Response.json({ data: { [operation]: { userErrors: [] } } });
  };
  return {
    admin: makeCatalogAdmin(
      Effect.succeed({ domain: "demo.myshopify.com", token: "test-token" }),
      fetcher
    ),
    writes,
  };
};

describe("Shopify tax provisioning", () => {
  it("validates native mappings before execution", () => {
    expect(() => {
      validateTaxConfig(setup, config);
    }).not.toThrow();
    expect(() => {
      validateTaxConfig(setup, {
        ...config,
        classes: [{ taxClassKey: "unknown", taxable: true }],
      });
    }).toThrow("exactly one");
    expect(() => {
      validateTaxConfig(setup, {
        ...config,
        productCategories: [
          {
            categoryId: "gid://shopify/TaxonomyCategory/aa",
            productKey: "unknown",
          },
        ],
      });
    }).toThrow("category mappings");
  });
  it.effect(
    "sets native variant taxability and leaves unchanged products alone on retry",
    () =>
      Effect.gen(function* () {
        const { admin, writes } = fixture();
        yield* applyTaxSetup(admin, setup, config, products);
        expect(writes).toEqual([
          {
            operation: "productVariantsBulkUpdate",
            variables: {
              productId: "gid://shopify/Product/1",
              variants: [
                { id: "gid://shopify/ProductVariant/2", taxable: true },
              ],
            },
          },
        ]);
        yield* applyTaxSetup(admin, setup, config, products);
        expect(writes).toHaveLength(1);
      })
  );
  it.effect("supports explicitly non-taxable goods", () =>
    Effect.gen(function* () {
      const { admin, writes } = fixture({ taxable: true });
      yield* applyTaxSetup(
        admin,
        setup,
        {
          ...config,
          classes: [{ taxClassKey: "goods", taxable: false }],
        },
        products
      );
      expect(writes[0]?.variables).toMatchObject({
        variants: [{ taxable: false }],
      });
    })
  );
  it.effect("sets an explicitly mapped native taxonomy category", () =>
    Effect.gen(function* () {
      const { admin, writes } = fixture({ taxable: true });
      const categorized = {
        ...config,
        productCategories: [
          {
            categoryId: "gid://shopify/TaxonomyCategory/aa-1",
            productKey: "bottle",
          },
        ],
      };
      yield* applyTaxSetup(admin, setup, categorized, products);
      expect(writes).toEqual([
        {
          operation: "productUpdate",
          variables: {
            product: {
              category: "gid://shopify/TaxonomyCategory/aa-1",
              id: "gid://shopify/Product/1",
            },
          },
        },
      ]);
      yield* applyTaxSetup(admin, setup, categorized, products);
      expect(writes).toHaveLength(1);
    })
  );
  it.effect("checks expected shop settings before product writes", () =>
    Effect.gen(function* () {
      const { admin, writes } = fixture({ taxesIncluded: true });
      const failure = yield* applyTaxSetup(admin, setup, config, products).pipe(
        Effect.flip
      );
      expect(failure.message).toContain("Settings > Taxes and duties");
      expect(writes).toHaveLength(0);
    })
  );
  it.effect("propagates native mutation errors", () =>
    Effect.gen(function* () {
      const { admin } = fixture({ rejectWrite: true });
      const failure = yield* applyTaxSetup(admin, setup, config, products).pipe(
        Effect.flip
      );
      expect(failure.message).toContain("Native tax write rejected");
    })
  );
  for (const options of [{ missing: true }, { truncated: true }]) {
    it.effect(
      `rejects unavailable product data: ${JSON.stringify(options)}`,
      () =>
        Effect.gen(function* () {
          const { admin, writes } = fixture(options);
          const failure = yield* applyTaxSetup(
            admin,
            setup,
            config,
            products
          ).pipe(Effect.flip);
          expect(failure.message).toContain("Product unavailable");
          expect(writes).toHaveLength(0);
        })
    );
  }
});
