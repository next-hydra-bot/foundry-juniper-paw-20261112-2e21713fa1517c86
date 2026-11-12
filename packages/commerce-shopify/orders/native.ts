import { Schema } from "effect";

import { ShopifyStoreAttribution } from "../store-attribution";

const Money = Schema.Struct({
  amount: Schema.String,
  currencyCode: Schema.String,
});
const MoneyBag = Schema.Struct({ presentmentMoney: Money });
export const PageInfo = Schema.Struct({
  endCursor: Schema.NullOr(Schema.String),
  hasNextPage: Schema.Boolean,
});
export const NativeSummary = Schema.Struct({
  cancelledAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  currentTotalPriceSet: MoneyBag,
  customer: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  displayFinancialStatus: Schema.NullOr(Schema.String),
  displayFulfillmentStatus: Schema.String,
  email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  id: Schema.String,
  name: Schema.String,
  poNumber: Schema.optionalKey(Schema.NullOr(Schema.String)),
  purchasingEntity: Schema.NullOr(
    Schema.Struct({
      __typename: Schema.String,
      location: Schema.optionalKey(
        Schema.NullOr(Schema.Struct({ id: Schema.String }))
      ),
    })
  ),
  storeAttribution: Schema.NullOr(ShopifyStoreAttribution),
  taxesIncluded: Schema.Boolean,
});
export type NativeSummary = typeof NativeSummary.Type;
export const summaryFields = `id name poNumber createdAt cancelledAt taxesIncluded displayFinancialStatus displayFulfillmentStatus
 currentTotalPriceSet { presentmentMoney { amount currencyCode } }
 customer { id } purchasingEntity { __typename ... on PurchasingCompany { location { id } } }
 storeAttribution: metafield(namespace:"commerce",key:"store_key") { type value }`;
export const Address = Schema.NullOr(
  Schema.Struct({
    address1: Schema.NullOr(Schema.String),
    address2: Schema.NullOr(Schema.String),
    city: Schema.NullOr(Schema.String),
    company: Schema.NullOr(Schema.String),
    countryCodeV2: Schema.NullOr(Schema.String),
    name: Schema.NullOr(Schema.String),
    province: Schema.NullOr(Schema.String),
    zip: Schema.NullOr(Schema.String),
  })
);
export const addressFields =
  "address1 address2 city company countryCodeV2 name province zip";
export const Line = Schema.Struct({
  currentQuantity: Schema.Int,
  discountedTotalSet: MoneyBag,
  id: Schema.String,
  image: Schema.NullOr(
    Schema.Struct({ altText: Schema.NullOr(Schema.String), url: Schema.String })
  ),
  originalUnitPriceSet: MoneyBag,
  product: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  quantity: Schema.Int,
  sku: Schema.NullOr(Schema.String),
  title: Schema.String,
  variant: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  variantTitle: Schema.NullOr(Schema.String),
});
export const lineFields = `id title variantTitle quantity currentQuantity sku image { url altText } product { id } variant { id }
 originalUnitPriceSet { presentmentMoney { amount currencyCode } } discountedTotalSet { presentmentMoney { amount currencyCode } }`;
export const Lines = Schema.Struct({
  nodes: Schema.Array(Line),
  pageInfo: PageInfo,
});
export const Fulfillment = Schema.Struct({
  displayStatus: Schema.NullOr(Schema.String),
  id: Schema.String,
  status: Schema.String,
  trackingInfo: Schema.Array(
    Schema.Struct({
      company: Schema.NullOr(Schema.String),
      number: Schema.NullOr(Schema.String),
      url: Schema.NullOr(Schema.String),
    })
  ),
});
export const NativeDetail = Schema.Struct({
  ...NativeSummary.fields,
  billingAddress: Address,
  currentShippingPriceSet: MoneyBag,
  currentSubtotalPriceSet: MoneyBag,
  currentTotalDiscountsSet: MoneyBag,
  currentTotalTaxSet: MoneyBag,
  fulfillments: Schema.Array(Fulfillment),
  lineItems: Lines,
  originalTotalPriceSet: MoneyBag,
  poNumber: Schema.NullOr(Schema.String),
  shippingAddress: Address,
  totalOutstandingSet: MoneyBag,
  totalReceivedSet: MoneyBag,
  totalRefundedSet: MoneyBag,
  updatedAt: Schema.String,
});
