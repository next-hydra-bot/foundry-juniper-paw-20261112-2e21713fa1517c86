import { Schema } from "effect";

import { PageInfo, ShopifyImage, ShopifyMoney } from "../client/schema";
import { ShopifyMetafields, SelectedOptions } from "./attributes";
import { OptionBindingsMetafield, ShopifyProductOptions } from "./options";

export const CardPriceVariants = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      compareAtPrice: Schema.NullOr(ShopifyMoney),
      price: ShopifyMoney,
    })
  ),
  pageInfo: PageInfo,
});

export const ShopifyProductCard = Schema.Struct({
  availableForSale: Schema.Boolean,
  description: Schema.String,
  featuredImage: Schema.NullOr(ShopifyImage),
  handle: Schema.String,
  id: Schema.String,
  priceRange: Schema.Struct({ minVariantPrice: ShopifyMoney }),
  priceVariants: CardPriceVariants,
  title: Schema.String,
});
export const ShopifyVariant = Schema.Struct({
  availableForSale: Schema.Boolean,
  compareAtPrice: Schema.NullOr(ShopifyMoney),
  currentlyNotInStock: Schema.Boolean,
  gallery: Schema.NullOr(
    Schema.Struct({
      references: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            __typename: Schema.Literal("MediaImage"),
            image: Schema.NullOr(ShopifyImage),
          })
        ),
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
      }),
    })
  ),
  id: Schema.String,
  image: Schema.NullOr(ShopifyImage),
  metafields: ShopifyMetafields,
  price: ShopifyMoney,
  quantityAvailable: Schema.NullOr(Schema.Int),
  selectedOptions: SelectedOptions,
  sku: Schema.NullOr(Schema.String),
});
export const VariantConnection = Schema.Struct({
  nodes: Schema.Array(ShopifyVariant),
  pageInfo: PageInfo,
});
export const ShopifyProduct = Schema.Struct({
  collections: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        handle: Schema.String,
        id: Schema.String,
        seedCatalog: Schema.NullOr(Schema.Struct({ value: Schema.String })),
        seedCategory: Schema.NullOr(Schema.Struct({ value: Schema.String })),
        title: Schema.String,
      })
    ),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  }),
  description: Schema.String,
  featuredImage: Schema.NullOr(ShopifyImage),
  handle: Schema.String,
  id: Schema.String,
  metafields: ShopifyMetafields,
  optionBindings: OptionBindingsMetafield,
  options: ShopifyProductOptions,
  title: Schema.String,
  variants: VariantConnection,
});
export type ShopifyProduct = typeof ShopifyProduct.Type;
export type ShopifyVariant = typeof ShopifyVariant.Type;
export type ShopifyProductCard = typeof ShopifyProductCard.Type;

export const VariantCardsResponse = Schema.Struct({
  nodes: Schema.Array(
    Schema.NullOr(
      Schema.Struct({
        __typename: Schema.Literal("ProductVariant"),
        id: Schema.String,
        sku: Schema.NullOr(Schema.String),
        availableForSale: Schema.Boolean,
        image: Schema.NullOr(ShopifyImage),
        selectedOptions: SelectedOptions,
        price: ShopifyMoney,
        compareAtPrice: Schema.NullOr(ShopifyMoney),
        product: Schema.Struct({
          id: Schema.String,
          handle: Schema.String,
          title: Schema.String,
          featuredImage: Schema.NullOr(ShopifyImage),
        }),
      })
    )
  ),
});
