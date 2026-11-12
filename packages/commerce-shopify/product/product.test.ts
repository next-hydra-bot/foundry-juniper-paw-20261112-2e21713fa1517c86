import { describe, expect, it } from "@effect/vitest";
import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { AnonymousCommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import {
  ProductId,
  ProductSlug,
  VariantId,
} from "@repo/commerce-core/product/identity";
import {
  ProductDiscovery,
  ListProductCardsInput,
} from "@repo/commerce-core/product/product-discovery";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { Effect, Layer, Option, Schema } from "effect";
import { vi } from "vitest";

import { toMetafields } from "../catalog/mapping";
import { mapMoney } from "../client/schema";
import {
  ShopifyRequestFailure,
  ShopifyStorefrontClient,
} from "../client/storefront";
import { guestCommerceContextLayer } from "../testing/commerce-context";
import { catalogOptionsFixture } from "../testing/options";
import { storefrontFixture } from "../testing/storefront";
import type { ShopifyRequest } from "../testing/storefront";
import { productDiscoveryLayer } from "./index";
import { mapProductDetail } from "./mapping";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const store = resolveStore(
  { locale: CommerceLocale.make("en-US") },
  storeConfiguration
);
const money = { amount: "12.34", currencyCode: "USD" };
const card = (id: string) => ({
  availableForSale: true,
  description: "Example",
  featuredImage: null,
  handle: id,
  id,
  priceRange: { minVariantPrice: money },
  priceVariants: {
    nodes: [{ compareAtPrice: null, price: money }],
    pageInfo: { endCursor: null, hasNextPage: false },
  },
  title: id,
});
const variant = (id: string, color: string) => ({
  availableForSale: true,
  compareAtPrice: { ...money, amount: "15.00" },
  currentlyNotInStock: false,
  gallery: null,
  id,
  image: null,
  metafields: [],
  price: money,
  quantityAvailable: 5,
  selectedOptions: [{ name: "Color", value: color }],
  sku: id,
});
const layer = (
  execute: (
    request: ShopifyRequest
  ) => Effect.Effect<Schema.Json, ShopifyRequestFailure>,
  requestStore = store
) =>
  productDiscoveryLayer.pipe(
    Layer.provide(
      Layer.merge(
        guestCommerceContextLayer(
          new AnonymousCommerceContextRequest({ store: requestStore })
        ),
        storefrontFixture(execute)
      )
    )
  );

describe("Shopify product discovery", () => {
  it.effect(
    "resolves saved Variants with native product labels and omits deleted Variants",
    () => {
      const id = VariantId.make("gid://shopify/ProductVariant/123");
      const missing = VariantId.make("gid://shopify/ProductVariant/456");
      return ProductDiscovery.pipe(
        Effect.flatMap((products) =>
          products.findVariantCards([id, id, missing])
        ),
        Effect.tap((cards) =>
          Effect.sync(() => {
            expect(cards).toHaveLength(1);
            expect(cards[0]).toMatchObject({
              id,
              title: "Jacket",
              slug: "jacket",
              options: [{ name: "Color", value: "Blue" }],
            });
          })
        ),
        Effect.provide(
          layer((request) => {
            expect(request.variables.ids).toEqual([id, missing]);
            return Effect.succeed({
              nodes: [
                {
                  ...variant(id, "Blue"),
                  __typename: "ProductVariant",
                  product: {
                    id: "product",
                    handle: "jacket",
                    title: "Jacket",
                    featuredImage: null,
                  },
                },
                null,
              ],
            });
          })
        )
      );
    }
  );
  it("maps native option references and image/color swatches into shared options", () => {
    const variants = [variant("v1", "Rouge")];
    const detail = mapProductDetail(
      {
        collections: { nodes: [], pageInfo: { hasNextPage: false } },
        description: "",
        featuredImage: null,
        handle: "example",
        id: "p1",
        metafields: [],
        optionBindings: null,
        options: [
          {
            id: "color-option",
            name: "Color",
            optionValues: [
              {
                id: "gid://shopify/ProductOptionValue/123",
                name: "Rouge",
                swatch: {
                  color: "#BD3D36",
                  image: {
                    previewImage: {
                      url: "https://cdn.shopify.com/red-swatch.png",
                      altText: "Red fabric",
                    },
                  },
                },
              },
            ],
          },
        ],
        title: "Example",
        variants: {
          nodes: variants,
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      },
      variants,
      store
    );
    expect(detail.options[0]?.values[0]).toEqual({
      id: "gid://shopify/ProductOptionValue/123",
      key: "Rouge",
      label: "Rouge",
      swatch: {
        color: "#BD3D36",
        image: {
          url: "https://cdn.shopify.com/red-swatch.png",
          altText: "Red fabric",
        },
      },
    });
  });

  it.effect(
    "names the missing Storefront permission and where to enable it",
    () =>
      Effect.gen(function* () {
        const result = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findBySlug(ProductSlug.make("example"))
          ),
          Effect.provide(
            productDiscoveryLayer.pipe(
              Layer.provide(
                Layer.merge(
                  guestCommerceContextLayer(
                    new AnonymousCommerceContextRequest({ store })
                  ),
                  Layer.succeed(
                    ShopifyStorefrontClient,
                    ShopifyStorefrontClient.of({
                      execute: () =>
                        new ShopifyRequestFailure({
                          codes: ["ACCESS_DENIED"],
                          reason: "rejected",
                          requiredScopes: [
                            "unauthenticated_read_product_inventory",
                          ],
                        }),
                      storeDomain: "example.myshopify.com",
                    })
                  )
                )
              )
            )
          ),
          Effect.result
        );
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            message:
              "Shopify rejected the product lookup (ACCESS_DENIED). Enable the required Storefront permissions in the Headless storefront: unauthenticated_read_product_inventory.",
          },
        });
      })
  );
  it.effect(
    "returns no product when Shopify does not expose the requested handle",
    () =>
      Effect.gen(function* () {
        const result = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findBySlug(ProductSlug.make("unpublished-product"))
          ),
          Effect.provide(layer(() => Effect.succeed({ product: null })))
        );
        expect(Option.isNone(result)).toBeTruthy();
      })
  );

  it.effect(
    "explains a rejected product lookup without guessing that the product is unpublished",
    () =>
      Effect.gen(function* () {
        const result = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findBySlug(ProductSlug.make("example"))
          ),
          Effect.provide(
            productDiscoveryLayer.pipe(
              Layer.provide(
                Layer.merge(
                  guestCommerceContextLayer(
                    new AnonymousCommerceContextRequest({ store })
                  ),
                  Layer.succeed(
                    ShopifyStorefrontClient,
                    ShopifyStorefrontClient.of({
                      execute: () =>
                        new ShopifyRequestFailure({ reason: "rejected" }),
                      storeDomain: "example.myshopify.com",
                    })
                  )
                )
              )
            )
          ),
          Effect.result
        );
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            message:
              "Shopify rejected the product lookup. Check the Storefront query and access permissions.",
            operation: "findBySlug",
          },
        });
      })
  );

  it.effect("includes the safe Shopify error code in the product failure", () =>
    Effect.gen(function* () {
      const result = yield* ProductDiscovery.pipe(
        Effect.flatMap((discovery) =>
          discovery.findBySlug(ProductSlug.make("example"))
        ),
        Effect.provide(
          productDiscoveryLayer.pipe(
            Layer.provide(
              Layer.merge(
                guestCommerceContextLayer(
                  new AnonymousCommerceContextRequest({ store })
                ),
                Layer.succeed(
                  ShopifyStorefrontClient,
                  ShopifyStorefrontClient.of({
                    execute: () =>
                      new ShopifyRequestFailure({
                        codes: ["fragmentNotUnique"],
                        reason: "rejected",
                      }),
                    storeDomain: "example.myshopify.com",
                  })
                )
              )
            )
          )
        ),
        Effect.result
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          message:
            "Shopify rejected the product lookup (fragmentNotUnique). Check the Storefront query and access permissions.",
        },
      });
    })
  );
  it.effect(
    "uses Shopify's language context and native option strings with stored domain keys",
    () =>
      Effect.gen(function* () {
        const source = loadCatalog("b2c").products.find(
          ({ key }) => key === "outdoor-trail-jacket"
        );
        const first = source?.variants[0];
        if (source === undefined || first === undefined) {
          return yield* Effect.die("Missing fixture");
        }
        const native = catalogOptionsFixture(source, "fr-FR");
        const options = native.options.map((option, index) => ({
          ...option,
          name: index === 0 ? "Taille modifiée" : "Nuance modifiée",
          optionValues: option.optionValues

            .map((value) => ({ ...value, name: `Shopify ${value.id}` })),
        }));
        const variants = [
          {
            ...variant("v1", "Ignored display string"),
            compareAtPrice: { ...money, currencyCode: "EUR" },
            metafields: toMetafields(first.attributes, source.productType),
            price: { ...money, currencyCode: "EUR" },
          },
        ];
        const contextStore = resolveStore(
          { locale: CommerceLocale.make("fr-FR") },
          storeConfiguration
        );
        const live = layer((request) => {
          expect(request.variables.language).toBe("FR");
          expect(request.query).toContain("optionValues");
          expect(request.query).toContain("commerce_shopify");
          return Effect.succeed<Schema.Json>({
            product: {
              collections: { nodes: [], pageInfo: { hasNextPage: false } },
              description: "Description",
              featuredImage: null,
              handle: source.key,
              id: "p1",
              metafields: [
                {
                  key: "productType",
                  type: "single_line_text_field",
                  value: source.productType,
                },
              ],
              optionBindings: {
                type: "json",
                value: JSON.stringify(native.optionBindings.value),
              },
              options,
              title: "Produit",
              variants: {
                nodes: variants,
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            },
          });
        }, contextStore);
        const detail = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findBySlug(ProductSlug.make(source.key))
          ),
          Effect.provide(live)
        );
        if (Option.isNone(detail)) {
          return yield* Effect.die("Missing product");
        }
        expect(detail.value.variants[0]?.optionValues).toEqual(
          first.optionValues
        );
        expect(
          detail.value.options.map(({ key, label }) => ({ key, label }))
        ).toEqual([
          { key: "size", label: "Taille modifiée" },
          { key: "color", label: "Nuance modifiée" },
        ]);
        expect(
          detail.value.options
            .flatMap(({ values }) => values)
            .every(({ label }) => label.startsWith("Shopify gid://"))
        ).toBeTruthy();
      })
  );
  it.effect(
    "maps all variant pages into the existing generic product model and option invariants",
    () =>
      Effect.gen(function* () {
        const live = layer((request) =>
          Effect.succeed<Schema.Json>(
            request.variables.after !== null &&
              request.variables.after !== undefined
              ? {
                  node: {
                    variants: {
                      nodes: [variant("v2", "Blue")],
                      pageInfo: { endCursor: null, hasNextPage: false },
                    },
                  },
                }
              : {
                  product: {
                    collections: {
                      nodes: [],
                      pageInfo: { hasNextPage: false },
                    },
                    description: "Example",
                    featuredImage: null,
                    handle: "example",
                    id: "p1",
                    metafields: [],
                    optionBindings: null,
                    options: [],
                    title: "Example",
                    variants: {
                      nodes: [variant("v1", "Red")],
                      pageInfo: { endCursor: "variants-2", hasNextPage: true },
                    },
                  },
                }
          )
        );
        const detail = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findBySlug(ProductSlug.make("example"))
          ),
          Effect.provide(live)
        );
        expect(Option.isSome(detail)).toBeTruthy();
        if (Option.isNone(detail)) {
          return;
        }
        expect(detail.value.productType).toBe("generic-product");
        expect(detail.value.variants).toHaveLength(2);
        expect(
          detail.value.options[0]?.values.map((value) => value.label)
        ).toEqual(["Red", "Blue"]);
        expect(detail.value.variants[0]?.price).toEqual({
          discounted: { centAmount: 1234, currencyCode: "USD" },
          regular: { centAmount: 1500, currencyCode: "USD" },
        });
      })
  );

  it.effect(
    "continues card pagination after exclusions and supplies the selected country and language",
    () =>
      Effect.gen(function* () {
        let calls = 0;
        const live = layer((request) =>
          Effect.sync(() => {
            calls += 1;
            expect(request.variables).toMatchObject({
              country: "US",
              language: "EN",
            });
            return {
              products: {
                nodes: [
                  card(
                    request.variables.after !== null &&
                      request.variables.after !== undefined
                      ? "keep"
                      : "exclude"
                  ),
                ],
                pageInfo: {
                  endCursor: "page-2",
                  hasNextPage:
                    request.variables.after === null ||
                    request.variables.after === undefined,
                },
              },
            };
          })
        );
        const cards = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.listCards(
              new ListProductCardsInput({
                excludeProductId: ProductId.make("exclude"),
                limit: 1,
              })
            )
          ),
          Effect.provide(live)
        );
        expect(cards.map((value) => value.id)).toEqual(["keep"]);
        expect(calls).toBe(2);
      })
  );

  it.effect("retains a catalog outage as a typed discovery failure", () =>
    Effect.gen(function* () {
      const result = yield* ProductDiscovery.pipe(
        Effect.flatMap((discovery) =>
          discovery.findBySlug(ProductSlug.make("example"))
        ),
        Effect.provide(
          layer(() => new ShopifyRequestFailure({ reason: "unavailable" }))
        ),
        Effect.result
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "ProductDiscoveryFailure", operation: "findBySlug" },
      });
    })
  );

  it("converts decimal money exactly and rejects mismatched currency or excess precision", () => {
    expect(
      mapMoney({ amount: "0.29", currencyCode: "USD" }, store).centAmount
    ).toBe(29);
    expect(() =>
      mapMoney({ amount: "0.291", currencyCode: "USD" }, store)
    ).toThrow(/currency|precision/u);
    expect(() =>
      mapMoney({ amount: "12", currencyCode: "GBP" }, store)
    ).toThrow(/currency|precision/u);
  });

  it("preserves backorder availability and falls back to the product image", () => {
    const variants = [
      {
        ...variant("v1", "Red"),
        currentlyNotInStock: true,
        quantityAvailable: -3,
      },
    ];
    const detail = mapProductDetail(
      {
        collections: { nodes: [], pageInfo: { hasNextPage: false } },
        description: "",
        featuredImage: {
          altText: null,
          url: "https://cdn.shopify.com/example.png",
        },
        handle: "example",
        id: "p1",
        metafields: [],
        optionBindings: null,
        options: [],
        title: "Example",
        variants: {
          nodes: variants,
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      },
      variants,
      store
    );
    expect(detail.variants[0]?.availability).toEqual({
      availableForSale: true,
      availableQuantity: undefined,
    });
    expect(detail.variants[0]?.images[0]?.url).toBe(
      "https://cdn.shopify.com/example.png"
    );
  });
});

describe("search audience contract", () => {
  it.effect(
    "supplies the shared search audience capability without inventing indexed pricing audiences",
    () =>
      Effect.gen(function* () {
        const discovery = yield* ProductDiscovery;
        expect(yield* discovery.searchAudience()).toEqual({
          priceAudienceIds: [],
        });
      }).pipe(
        Effect.provide(
          layer(() => Effect.die("No native catalog request is needed"))
        )
      )
  );
});

it.effect(
  "pairs a product-card sale reference with the cheapest variant through price pagination",
  () => {
    const seen: string[] = [];
    return Effect.gen(function* () {
      const result = yield* ProductDiscovery.pipe(
        Effect.flatMap((service) =>
          service.listCards(new ListProductCardsInput({ limit: 1 }))
        )
      );
      expect(result[0]).toMatchObject({
        regularStartingPrice: { centAmount: 1800 },
        startingPrice: { centAmount: 1234 },
      });
      expect(seen).toContain("price-page-2");
    }).pipe(
      Effect.provide(
        layer((request) =>
          Effect.sync((): Schema.Json => {
            if (request.query.includes("query CardPriceVariants(")) {
              seen.push(
                Schema.decodeUnknownSync(Schema.String)(request.variables.after)
              );
              return {
                node: {
                  id: "product-1",
                  priceVariants: {
                    nodes: [
                      {
                        compareAtPrice: { ...money, amount: "18.00" },
                        price: money,
                      },
                    ],
                    pageInfo: { endCursor: null, hasNextPage: false },
                  },
                },
              };
            }
            return {
              products: {
                nodes: [
                  {
                    ...card("product-1"),
                    priceVariants: {
                      nodes: [
                        {
                          compareAtPrice: { ...money, amount: "16.00" },
                          price: { ...money, amount: "15.00" },
                        },
                      ],
                      pageInfo: {
                        endCursor: "price-page-2",
                        hasNextPage: true,
                      },
                    },
                  },
                ],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            };
          })
        )
      )
    );
  }
);
