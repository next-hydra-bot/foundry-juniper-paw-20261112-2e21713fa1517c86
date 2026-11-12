import { ProductVariantCard } from "@repo/commerce-core/product/model";
import type { ProductCard } from "@repo/commerce-core/product/model";
import type { ProductSearchAudience } from "@repo/commerce-core/product/product-discovery";
import {
  ProductDiscovery,
  ProductDiscoveryFailure,
} from "@repo/commerce-core/product/product-discovery";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer, Option, Schema } from "effect";

import { mapMoney, PageInfo } from "../client/schema";
import { ShopifyStorefrontClient } from "../client/storefront";
import type { ShopifyRequestFailure } from "../client/storefront";
import { visibleOptions } from "./attributes";
import { categoryDiscoveryMethods } from "./categories";
import {
  variantCardsQuery,
  productQuery,
  variantsQuery,
  cardPriceVariantsQuery,
  productsQuery,
  collectionProductsQuery,
} from "./graphql";
import { mapProductCard, mapProductDetail } from "./mapping";
import { attributeIdentifiers } from "./model";
import {
  VariantCardsResponse,
  ShopifyProduct,
  ShopifyProductCard,
  VariantConnection,
  CardPriceVariants,
} from "./schema";
import type { ShopifyVariant } from "./schema";

const failure =
  (operation: "findBySlug" | "listCards" | "findVariantCards") =>
  (cause: ShopifyRequestFailure) => {
    const subject =
      operation === "findBySlug" ? "product lookup" : "product listing";
    const codes = cause.codes ?? [];
    const code = codes.length === 0 ? "" : ` (${codes.join(", ")})`;
    const requiredScopes = cause.requiredScopes ?? [];
    const accessHint =
      requiredScopes.length === 0
        ? "Check the Storefront query and access permissions."
        : `Enable the required Storefront permissions in the Headless storefront: ${requiredScopes.join(", ")}.`;
    const messages = {
      invalidResponse: `Shopify returned an invalid response for the ${subject}${code}. Check the API version and provider mapping.`,
      rejected: `Shopify rejected the ${subject}${code}. ${accessHint}`,
      unavailable: `Shopify is unavailable for the ${subject}${code}. Try again shortly.`,
    };
    return new ProductDiscoveryFailure({
      cause,
      message: messages[cause.reason],
      operation,
    });
  };

const CardConnection = Schema.Struct({
  nodes: Schema.Array(ShopifyProductCard),
  pageInfo: PageInfo,
});
const CardsResponse = Schema.Struct({
  collection: Schema.optional(
    Schema.NullOr(Schema.Struct({ products: CardConnection }))
  ),
  products: Schema.optional(CardConnection),
});
const DetailResponse = Schema.Struct({
  product: Schema.NullOr(ShopifyProduct),
});
const VariantsResponse = Schema.Struct({
  node: Schema.NullOr(Schema.Struct({ variants: VariantConnection })),
});
export interface ShopifyProductBuyer {
  readonly customerAccessToken: string;
  readonly companyLocationId: string;
  readonly searchAudience: Effect.Effect<
    ProductSearchAudience,
    ProductDiscoveryFailure
  >;
}
export const productDiscoveryLayerWith = <R>(
  buyerSource: Effect.Effect<ShopifyProductBuyer | undefined, never, R>
) =>
  Layer.effect(
    ProductDiscovery,
    Effect.gen(function* () {
      const client = yield* ShopifyStorefrontClient;
      const context = yield* CommerceContext;
      const { store, principal } = context;
      const execute = <A>(
        request: Effect.Effect<A, ShopifyRequestFailure, CommerceContext>
      ) => request.pipe(Effect.provideService(CommerceContext, context));
      const identity = yield* buyerSource;
      const buyer =
        identity === undefined
          ? undefined
          : {
              companyLocationId: identity.companyLocationId,
              customerAccessToken: identity.customerAccessToken,
            };
      if (
        principal._tag === "CustomerCommercePrincipal" &&
        buyer?.companyLocationId !== principal.businessUnitId
      ) {
        return yield* Effect.die(
          "Shopify authenticated catalog context is not configured"
        );
      }

      return ProductDiscovery.of({
        findVariantCards: Effect.fn("ShopifyProductDiscovery.findVariantCards")(
          function* (ids) {
            const requested: readonly string[] = [
              ...new Set(
                ids.filter((id) =>
                  /^gid:\/\/shopify\/ProductVariant\/\d+$/u.test(id)
                )
              ),
            ];
            const cards: ProductVariantCard[] = [];
            for (let index = 0; index < requested.length; index += 50) {
              const page = requested.slice(index, index + 50);
              const response = yield* client
                .execute(
                  async (sdk, signal) =>
                    await sdk.graphql(variantCardsQuery, {
                      signal,
                      variables: { ids: page, buyer },
                    })
                )
                .pipe(
                  execute,
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(VariantCardsResponse)
                  )
                );
              for (const node of response.nodes) {
                if (!node || !requested.includes(node.id)) continue;
                const image = node.image ?? node.product.featuredImage;
                const effective = mapMoney(node.price, store);
                const compareAt = node.compareAtPrice
                  ? mapMoney(node.compareAtPrice, store)
                  : undefined;
                cards.push(
                  yield* Schema.decodeUnknownEffect(ProductVariantCard)({
                    availability: { availableForSale: node.availableForSale },
                    featuredImage: image
                      ? { url: image.url, altText: image.altText ?? undefined }
                      : undefined,
                    id: node.id,
                    productId: node.product.id,
                    slug: node.product.handle,
                    title: node.product.title,
                    sku: node.sku || undefined,
                    options: visibleOptions(node.selectedOptions),
                    price:
                      compareAt && compareAt.centAmount > effective.centAmount
                        ? { regular: compareAt, discounted: effective }
                        : { regular: effective },
                  })
                );
              }
            }
            return cards;
          },
          Effect.mapError(
            (cause) =>
              new ProductDiscoveryFailure({
                cause,
                operation: "findVariantCards",
                message: "Shopify saved Product lookup failed",
              })
          )
        ),
        ...categoryDiscoveryMethods(client, context),
        findBySlug: (slug) =>
          Effect.gen(function* () {
            const response = yield* client
              .execute(
                async (sdk, signal) =>
                  await sdk.graphql(productQuery, {
                    signal,
                    variables: { attributeIdentifiers, buyer, handle: slug },
                  })
              )
              .pipe(
                execute,
                Effect.flatMap((data) =>
                  Schema.decodeUnknownEffect(DetailResponse)(data).pipe(
                    Effect.orDie
                  )
                )
              );
            if (!response.product) {
              return Option.none();
            }
            const { product } = response;
            const variants: ShopifyVariant[] = [...product.variants.nodes];
            let page = product.variants.pageInfo;
            const cursors = new Set<string>();
            while (page.hasNextPage) {
              if (!page.endCursor || cursors.has(page.endCursor)) {
                return yield* Effect.die(
                  "Shopify returned an invalid variant cursor"
                );
              }
              cursors.add(page.endCursor);
              const after = page.endCursor;
              const next = yield* client
                .execute(
                  async (sdk, signal) =>
                    await sdk.graphql(variantsQuery, {
                      signal,
                      variables: {
                        after,
                        attributeIdentifiers,
                        buyer,
                        id: product.id,
                      },
                    })
                )
                .pipe(
                  execute,
                  Effect.flatMap((data) =>
                    Schema.decodeUnknownEffect(VariantsResponse)(data).pipe(
                      Effect.orDie
                    )
                  )
                );
              if (!next.node) {
                return yield* Effect.die(
                  "Shopify product disappeared during pagination"
                );
              }
              variants.push(...next.node.variants.nodes);
              page = next.node.variants.pageInfo;
            }
            if (variants.length === 0) {
              return Option.none();
            }
            return Option.some(mapProductDetail(product, variants, store));
          }).pipe(Effect.mapError(failure("findBySlug"))),
        listCards: (input) =>
          Effect.gen(function* () {
            const cards: ProductCard[] = [];
            let after: string | null = null;
            do {
              const variables = {
                after,
                buyer,
                first: Math.min(input.limit + 1, 250),
              };
              const { categoryId } = input;
              const request: Effect.Effect<
                typeof CardsResponse.Encoded,
                ShopifyRequestFailure,
                CommerceContext
              > = categoryId
                ? client.execute(
                    async (sdk, signal) =>
                      await sdk.graphql(collectionProductsQuery, {
                        signal,
                        variables: { ...variables, categoryId },
                      })
                  )
                : client.execute(
                    async (sdk, signal) =>
                      await sdk.graphql(productsQuery, { signal, variables })
                  );
              const response = yield* request.pipe(
                execute,
                Effect.flatMap((data) =>
                  Schema.decodeUnknownEffect(CardsResponse)(data).pipe(
                    Effect.orDie
                  )
                )
              );
              const connection: typeof CardConnection.Type | null | undefined =
                input.categoryId
                  ? response.collection?.products
                  : response.products;
              if (!connection) {
                break;
              }
              for (const product of connection.nodes) {
                if (product.id !== input.excludeProductId) {
                  const prices = [...product.priceVariants.nodes];
                  let pricePage = product.priceVariants.pageInfo;
                  const cursors = new Set<string>();
                  while (pricePage.hasNextPage) {
                    const after = pricePage.endCursor;
                    if (!after || cursors.has(after)) {
                      return yield* Effect.die(
                        "Shopify returned an invalid card price cursor"
                      );
                    }
                    cursors.add(after);
                    const data = yield* client
                      .execute(
                        async (sdk, signal) =>
                          await sdk.graphql(cardPriceVariantsQuery, {
                            signal,
                            variables: { after, buyer, id: product.id },
                          })
                      )
                      .pipe(execute);
                    const next = yield* Schema.decodeUnknownEffect(
                      Schema.Struct({
                        node: Schema.NullOr(
                          Schema.Struct({
                            id: Schema.String,
                            priceVariants: CardPriceVariants,
                          })
                        ),
                      })
                    )(data).pipe(Effect.orDie);
                    if (next.node?.id !== product.id) {
                      return yield* Effect.die(
                        "Shopify product disappeared during card price pagination"
                      );
                    }
                    prices.push(...next.node.priceVariants.nodes);
                    pricePage = next.node.priceVariants.pageInfo;
                  }
                  cards.push(
                    mapProductCard(
                      {
                        ...product,
                        priceVariants: { nodes: prices, pageInfo: pricePage },
                      },
                      store
                    )
                  );
                }
              }
              if (!connection.pageInfo.hasNextPage) {
                break;
              }
              if (
                !connection.pageInfo.endCursor ||
                connection.pageInfo.endCursor === after
              ) {
                return yield* Effect.die(
                  "Shopify returned an invalid product cursor"
                );
              }
              after = connection.pageInfo.endCursor;
            } while (cards.length < input.limit);
            return cards.slice(0, input.limit);
          }).pipe(Effect.mapError(failure("listCards"))),
        searchAudience: () =>
          identity?.searchAudience ?? Effect.succeed({ priceAudienceIds: [] }),
      });
    })
  );

export const productDiscoveryLayer = productDiscoveryLayerWith(
  Effect.succeed(undefined)
);
