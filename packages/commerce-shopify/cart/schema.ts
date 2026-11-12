import { Schema } from "effect";

import { PageInfo, ShopifyImage, ShopifyMoney } from "../client/schema";
import { SelectedOptions } from "../product/attributes";
import { ShopifyStoreAttribution } from "../store-attribution";

const Merchandise = Schema.Struct({
  id: Schema.String,
  image: Schema.NullOr(ShopifyImage),
  product: Schema.Struct({ id: Schema.String, title: Schema.String }),
  selectedOptions: SelectedOptions,
  sku: Schema.NullOr(Schema.String),
});
const DiscountApplication = Schema.Struct({
  label: Schema.optional(Schema.String),
  targetType: Schema.String,
  totalAllocatedAmount: ShopifyMoney,
});
const Line = Schema.Struct({
  cost: Schema.Struct({
    amountPerQuantity: ShopifyMoney,
    compareAtAmountPerQuantity: Schema.NullOr(ShopifyMoney),
    subtotalAmount: ShopifyMoney,
    totalAmount: ShopifyMoney,
  }),
  discountAllocations: Schema.Array(
    Schema.Struct({
      discountedAmount: ShopifyMoney,
      sourceDiscountApplication: DiscountApplication,
    })
  ),
  id: Schema.String,
  merchandise: Merchandise,
  quantity: Schema.Int,
});
export const ShopifyCart = Schema.Struct({
  buyerIdentity: Schema.Struct({
    countryCode: Schema.NullOr(Schema.String),
    customer: Schema.NullOr(Schema.Struct({ id: Schema.String })),
    purchasingCompany: Schema.NullOr(
      Schema.Struct({
        company: Schema.Struct({ id: Schema.String }),
        location: Schema.Struct({ id: Schema.String }),
      })
    ),
  }),
  checkoutUrl: Schema.String,
  cost: Schema.Struct({ totalAmount: ShopifyMoney }),
  discountApplications: Schema.Array(DiscountApplication),
  discountCodes: Schema.Array(
    Schema.Struct({ applicable: Schema.Boolean, code: Schema.String })
  ),
  id: Schema.String,
  lines: Schema.Struct({ nodes: Schema.Array(Line), pageInfo: PageInfo }),
  storeAttribution: Schema.NullOr(ShopifyStoreAttribution),
  totalQuantity: Schema.Int,
});
export type ShopifyCart = typeof ShopifyCart.Type;
export const CartResponse = Schema.Struct({ cart: Schema.NullOr(ShopifyCart) });
export const MutationResult = Schema.Struct({
  cart: Schema.NullOr(ShopifyCart),
  userErrors: Schema.Array(
    Schema.Struct({
      code: Schema.NullOr(Schema.String),
      field: Schema.NullOr(Schema.Array(Schema.String)),
      message: Schema.String,
    })
  ),
  warnings: Schema.Array(
    Schema.Struct({ code: Schema.String, message: Schema.String })
  ),
});
export const CartCookie = Schema.Struct({
  buyer: Schema.optional(Schema.String),
  companyLocationId: Schema.optional(Schema.String),
  id: Schema.String,
  locale: Schema.String,
  shop: Schema.String,
  storeKey: Schema.String,
  tokenFingerprint: Schema.optional(Schema.String),
});
export const CartCookieJson = Schema.fromJsonString(CartCookie);
