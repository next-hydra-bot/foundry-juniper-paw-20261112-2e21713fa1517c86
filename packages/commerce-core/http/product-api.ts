import { definePublicError } from "@repo/errors";
import { Effect, Option, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { ProductDetail } from "../product/generated/attributes";
import { CategoryId, ProductId, ProductSlug } from "../product/identity";
import { ProductCard } from "../product/model";
import {
  ListProductCardsInput,
  ProductDiscovery,
} from "../product/product-discovery";
import { CommerceRequestHeaders } from "./commerce-request";

const unavailable = definePublicError({
  category: "unavailable",
  code: "catalog.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "ProductDiscoveryFailure",
});
const ListQuery = Schema.Struct({
  categoryId: Schema.optional(CategoryId),
  excludeProductId: Schema.optional(ProductId),
  limit: Schema.optional(
    Schema.NumberFromString.check(
      Schema.isInt(),
      Schema.isBetween({ maximum: 100, minimum: 1 })
    )
  ),
});
export const productHttpPrograms = {
  detail: (slug: typeof ProductSlug.Type) =>
    ProductDiscovery.pipe(
      Effect.flatMap((products) => products.findBySlug(slug)),
      Effect.map(Option.getOrNull),
      Effect.mapError(() =>
        unavailable.make({ message: "The product is temporarily unavailable." })
      )
    ),
  list: (input: typeof ListQuery.Type) =>
    ProductDiscovery.pipe(
      Effect.flatMap((products) =>
        products.listCards(
          new ListProductCardsInput({ ...input, limit: input.limit ?? 20 })
        )
      ),
      Effect.mapError(() =>
        unavailable.make({ message: "The catalog is temporarily unavailable." })
      )
    ),
};

/** Hosts supply the same verified Commerce Context used by cart operations. */
export const makeProductApiGroup = <Headers extends Schema.Top>(
  headers: Headers
) =>
  HttpApiGroup.make("catalog")
    .add(
      HttpApiEndpoint.get("list", "/products", {
        error: unavailable.schema,
        headers,
        query: ListQuery,
        success: Schema.Array(ProductCard),
      })
    )
    .add(
      HttpApiEndpoint.get("detail", "/products/:slug", {
        error: unavailable.schema,
        headers,
        params: Schema.Struct({ slug: ProductSlug }),
        success: Schema.NullOr(ProductDetail),
      })
    );

export class ProductApiGroup extends makeProductApiGroup(
  CommerceRequestHeaders
) {}
