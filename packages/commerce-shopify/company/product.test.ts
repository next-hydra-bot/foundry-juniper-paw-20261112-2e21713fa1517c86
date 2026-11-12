import { describe, expect, it } from "@effect/vitest";
import {
  ProductDiscovery,
  ListProductCardsInput,
} from "@repo/commerce-core/product/product-discovery";
import { Effect, Layer, Schema } from "effect";

import {
  companyContextFixture,
  customerAccountFixture,
} from "../testing/customer-account";
import { storefrontFixture } from "../testing/storefront";
import { ShopifyCompanyAdmin } from "./admin";
import {
  companyProductDiscoveryLayer,
  companyProductDiscoveryLayerWith,
} from "./product";
import { ShopifyPurchasingPolicyBindings } from "./purchasing-policy-bindings";

const cards = ProductDiscovery.pipe(
  Effect.flatMap((products) =>
    products.listCards(ListProductCardsInput.make({ limit: 5 }))
  )
);

describe("Shopify company product prices", () => {
  it.effect(
    "asks Shopify for the selected buyer's prices and isolates the response between companies",
    () =>
      Effect.gen(function* () {
        const native = storefrontFixture((request) =>
          Effect.sync(() => {
            const location = Schema.decodeUnknownSync(
              Schema.Struct({
                companyLocationId: Schema.String,
                customerAccessToken: Schema.String,
              })
            )(request.variables.buyer);
            expect(location).toMatchObject({
              customerAccessToken: "customer-token",
            });
            const id =
              location.companyLocationId === "gid://shopify/CompanyLocation/1"
                ? 1
                : 2;
            return {
              products: {
                nodes: [
                  {
                    availableForSale: true,
                    description: "",
                    featuredImage: null,
                    handle: "attachment",
                    id: "product-1",
                    priceRange: {
                      minVariantPrice: {
                        amount: id === 1 ? "150.00" : "165.00",
                        currencyCode: "USD",
                      },
                    },
                    priceVariants: {
                      nodes: [
                        {
                          compareAtPrice: null,
                          price: {
                            amount: id === 1 ? "150.00" : "165.00",
                            currencyCode: "USD",
                          },
                        },
                      ],
                      pageInfo: { endCursor: null, hasNextPage: false },
                    },
                    title: "Attachment",
                  },
                ],
                pageInfo: { endCursor: null, hasNextPage: false },
              },
            };
          })
        );
        const first = yield* cards.pipe(
          Effect.provide(
            companyProductDiscoveryLayer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  native,
                  customerAccountFixture(),
                  companyContextFixture()
                )
              )
            )
          )
        );
        const second = yield* cards.pipe(
          Effect.provide(
            companyProductDiscoveryLayer.pipe(
              Layer.provideMerge(
                Layer.mergeAll(
                  native,
                  customerAccountFixture(),
                  companyContextFixture("gid://shopify/CompanyLocation/2")
                )
              )
            )
          )
        );
        expect([
          first[0]?.startingPrice?.centAmount,
          second[0]?.startingPrice?.centAmount,
        ]).toEqual([15_000, 16_500]);
      })
  );
});

const bindings = Schema.decodeUnknownSync(ShopifyPurchasingPolicyBindings)([
  {
    currency: "USD",
    key: "gold-policy",
    label: "Gold",
    locale: "en-US",
    pricingCatalogId: "gid://shopify/MarketCatalog/1",
    pricingGroupKey: "gold",
    pricingMarketId: "gid://shopify/Market/1",
    storeKey: "default-store",
  },
]);
const marketPage = (
  policy: ShopifyPurchasingPolicyBindings[number],
  members: readonly string[],
  pageInfo?: { hasNextPage: boolean; endCursor: string | null }
) => ({
  market: {
    catalogs: {
      nodes: [
        {
          id: policy.pricingCatalogId,
          priceList: { currency: policy.currency },
          publication: null,
          status: "ACTIVE",
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    conditions: {
      companyLocationsCondition: {
        applicationLevel: "SPECIFIC",
        companyLocations: {
          nodes: members.map((id) => ({ id })),
          pageInfo: pageInfo ?? { endCursor: null, hasNextPage: false },
        },
      },
      conditionTypes: ["COMPANY_LOCATION"],
    },
    id: policy.pricingMarketId,
    status: "ACTIVE",
  },
});
const searchLayer = (
  request: ShopifyCompanyAdmin["Service"]["request"],
  configured: ShopifyPurchasingPolicyBindings = bindings
) =>
  companyProductDiscoveryLayerWith(
    Layer.succeed(ShopifyCompanyAdmin, ShopifyCompanyAdmin.of({ request })),
    () => configured
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        storefrontFixture(() =>
          Effect.die("Search does not query native products")
        ),
        customerAccountFixture(),
        companyContextFixture()
      )
    )
  );

describe("search audience contract", () => {
  it.effect("resolves the selected location's pricing group on demand", () =>
    Effect.gen(function* () {
      const [policy] = bindings;
      if (!policy) {
        throw new Error("Missing test pricing policy");
      }
      const calls: Readonly<Record<string, Schema.Json>>[] = [];
      const discovery = yield* ProductDiscovery.pipe(
        Effect.provide(
          searchLayer((_query, variables = {}) =>
            Effect.sync(() => {
              calls.push(variables);
              return marketPage(policy, ["gid://shopify/CompanyLocation/1"]);
            })
          )
        )
      );
      expect(calls).toEqual([]);
      expect(yield* discovery.searchAudience()).toEqual({
        priceAudienceIds: ["group:gold"],
      });
      expect(calls).toMatchObject([
        { after: null, id: "gid://shopify/Market/1" },
      ]);
    })
  );

  it.effect(
    "pages Market memberships until the selected buyer matches and stops without loading later pages",
    () =>
      Effect.gen(function* () {
        const [policy] = bindings;
        if (!policy) {
          throw new Error("Missing test pricing policy");
        }
        const cursors: Schema.Json[] = [];
        const audience = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) => discovery.searchAudience()),
          Effect.provide(
            searchLayer((_query, variables = {}) =>
              Effect.sync(() => {
                cursors.push(variables.after ?? null);
                return variables.after === null
                  ? marketPage(policy, ["gid://shopify/CompanyLocation/99"], {
                      endCursor: "page-2",
                      hasNextPage: true,
                    })
                  : marketPage(policy, ["gid://shopify/CompanyLocation/1"], {
                      endCursor: "unneeded-page-3",
                      hasNextPage: true,
                    });
              })
            )
          )
        );
        expect(audience).toEqual({ priceAudienceIds: ["group:gold"] });
        expect(cursors).toEqual([null, "page-2"]);
      })
  );

  it.effect(
    "fails closed when the selected location has no matching or ambiguous pricing Market",
    () =>
      Effect.gen(function* () {
        const configured = [
          ...bindings,
          ...bindings.map((binding) => ({
            ...binding,
            key: binding.key,
            pricingCatalogId: "gid://shopify/MarketCatalog/2",
            pricingGroupKey: "standard",
            pricingMarketId: "gid://shopify/Market/2",
          })),
        ];
        for (const members of [[], ["gid://shopify/CompanyLocation/1"]]) {
          const failure = yield* ProductDiscovery.pipe(
            Effect.flatMap((discovery) => discovery.searchAudience()),
            Effect.provide(
              searchLayer(
                (_query, variables = {}) =>
                  Effect.sync(() => {
                    const policy = configured.find(
                      (binding) => binding.pricingMarketId === variables.id
                    );
                    if (!policy) {
                      throw new Error(
                        "Only configured pricing Markets should be queried"
                      );
                    }
                    return marketPage(policy, members);
                  }),
                configured
              )
            ),
            Effect.flip
          );
          expect(failure).toMatchObject({
            _tag: "ProductDiscoveryFailure",
            operation: "searchAudience",
          });
          expect(failure.message).toContain("exactly one");
        }
      })
  );

  it.effect(
    "rejects a changed Catalog currency instead of serving the configured group's stale prices",
    () =>
      Effect.gen(function* () {
        const [policy] = bindings;
        if (!policy) {
          throw new Error("Missing test pricing policy");
        }
        const failure = yield* ProductDiscovery.pipe(
          Effect.flatMap((discovery) => discovery.searchAudience()),
          Effect.provide(
            searchLayer(() =>
              Effect.succeed(
                marketPage({ ...policy, currency: "EUR" }, [
                  "gid://shopify/CompanyLocation/1",
                ])
              )
            )
          ),
          Effect.flip
        );
        expect(failure).toMatchObject({
          _tag: "ProductDiscoveryFailure",
          operation: "searchAudience",
        });
        expect(failure.message).toContain("configured Catalog and currency");
      })
  );
});
