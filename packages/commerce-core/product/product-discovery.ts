import { Context, Effect, Layer, Option, Schema } from "effect";

import type { ProductCategoryDetail } from "./category";
import type { ProductDetail } from "./generated/attributes";
import { CategoryId, ProductId, VariantId } from "./identity";
import type { CategorySlug, ProductSlug } from "./identity";
import type { ProductCard, ProductVariantCard } from "./model";

export class ListProductCardsInput extends Schema.Class<ListProductCardsInput>(
  "ListProductCardsInput"
)({
  categoryId: Schema.optional(CategoryId),
  excludeProductId: Schema.optional(ProductId),
  limit: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

export const ProductDiscoveryOperation = Schema.Literals([
  "findBySlug",
  "findVariantCards",
  "listCards",
  "searchAudience",
  "findCategoryBySlug",
  "listCategories",
]);
export type ProductDiscoveryOperation = typeof ProductDiscoveryOperation.Type;

export class ProductDiscoveryFailure extends Schema.TaggedError<ProductDiscoveryFailure>()(
  "ProductDiscoveryFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    operation: ProductDiscoveryOperation,
  }
) {}

interface ProductDiscoveryMethods {
  /** Missing or unpublished Variants are omitted; callers match results by opaque ID. */
  readonly findVariantCards: (
    ids: readonly VariantId[]
  ) => Effect.Effect<readonly ProductVariantCard[], ProductDiscoveryFailure>;
  readonly findCategoryBySlug: (
    slug: CategorySlug
  ) => Effect.Effect<
    Option.Option<ProductCategoryDetail>,
    ProductDiscoveryFailure
  >;
  readonly listCategories: () => Effect.Effect<
    readonly ProductCategoryDetail[],
    ProductDiscoveryFailure
  >;
  readonly findBySlug: (
    slug: ProductSlug
  ) => Effect.Effect<Option.Option<ProductDetail>, ProductDiscoveryFailure>;
  readonly listCards: (
    input: ListProductCardsInput
  ) => Effect.Effect<readonly ProductCard[], ProductDiscoveryFailure>;
  readonly searchAudience: () => Effect.Effect<
    ProductSearchAudience,
    ProductDiscoveryFailure
  >;
}

export interface ProductSearchAudience {
  /** Opaque identifiers for the current customer's applicable price audiences. */
  readonly priceAudienceIds: readonly string[];
}

export type ProductDiscoveryTestHandlers = Partial<ProductDiscoveryMethods>;

export class ProductDiscovery extends Context.Service<
  ProductDiscovery,
  ProductDiscoveryMethods
>()("@repo/commerce-core/ProductDiscovery") {
  static readonly testLayer = (handlers: ProductDiscoveryTestHandlers = {}) =>
    Layer.succeed(
      ProductDiscovery,
      ProductDiscovery.of({
        findVariantCards: (ids) =>
          handlers.findVariantCards?.(ids) ??
          Effect.succeed<readonly ProductVariantCard[]>([]),
        findCategoryBySlug: (slug) =>
          handlers.findCategoryBySlug?.(slug) ??
          Effect.succeed(Option.none<ProductCategoryDetail>()),
        listCategories: () =>
          handlers.listCategories?.() ??
          Effect.succeed<readonly ProductCategoryDetail[]>([]),
        findBySlug: Effect.fn("ProductDiscovery.findBySlug")(
          (slug) =>
            handlers.findBySlug?.(slug) ??
            Effect.succeed(Option.none<ProductDetail>())
        ),
        listCards: Effect.fn("ProductDiscovery.listCards")(
          (input) =>
            handlers.listCards?.(input) ??
            Effect.succeed<readonly ProductCard[]>([])
        ),
        searchAudience: Effect.fn("ProductDiscovery.searchAudience")(
          () =>
            handlers.searchAudience?.() ??
            Effect.succeed<ProductSearchAudience>({
              priceAudienceIds: [],
            })
        ),
      })
    );
}
