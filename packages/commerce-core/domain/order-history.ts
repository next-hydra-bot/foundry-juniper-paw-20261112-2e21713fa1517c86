import { DateTime, Schema } from "effect";

import { ProductId, Sku, VariantId } from "../product/identity";
import { ProductImage } from "../product/image";
import { CommerceLocale, StoreKey } from "../store";
import { CountryCode } from "./address";
import { CommerceBusinessUnitId } from "./commerce-account";
import { CommerceCustomerId } from "./customer";
import { CurrencyCode } from "./money";
import { OrderId, OrderNumber } from "./order-identity";

/** Exact major-unit decimal; never a float or an assumption of two fraction digits. */
export const OrderMoney = Schema.Struct({
  amount: Schema.String.check(
    Schema.isPattern(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u)
  ),
  currencyCode: CurrencyCode,
});
export type OrderMoney = typeof OrderMoney.Type;

/** Tax treatment accompanies the native amount; unknown is not tax-exclusive. */
export const OrderAmount = Schema.Struct({
  money: OrderMoney,
  taxIncluded: Schema.Literals(["yes", "no", "unknown"]),
});
export type OrderAmount = typeof OrderAmount.Type;

/** These observations are independent; fulfillment does not prove delivery or payment. */
export const OrderStatus = Schema.Struct({
  cancellation: Schema.Literals(["notCancelled", "cancelled", "unknown"]),
  delivery: Schema.Literals([
    "notRequired",
    "pending",
    "ready",
    "inTransit",
    "partiallyDelivered",
    "delivered",
    "delayed",
    "backordered",
    "failed",
    "unknown",
  ]),
  fulfillment: Schema.Literals([
    "notRequired",
    "unfulfilled",
    "inProgress",
    "partiallyFulfilled",
    "fulfilled",
    "onHold",
    "scheduled",
    "unknown",
  ]),
  payment: Schema.Literals([
    "pending",
    "balanceDue",
    "authorized",
    "partiallyPaid",
    "paid",
    "partiallyRefunded",
    "refunded",
    "creditOwed",
    "failed",
    "voided",
    "expired",
    "unknown",
  ]),
});
export type OrderStatus = typeof OrderStatus.Type;

export const OrderPurchasingContext = Schema.Union([
  Schema.TaggedStruct("B2COrder", {}),
  Schema.TaggedStruct("B2BOrder", { businessUnitId: CommerceBusinessUnitId }),
]);
export type OrderPurchasingContext = typeof OrderPurchasingContext.Type;

export const OrderSummary = Schema.Struct({
  createdAt: Schema.DateTimeUtcFromString,
  id: OrderId,
  number: Schema.optional(OrderNumber),
  purchaseOrderNumber: Schema.optional(Schema.String),
  purchasingContext: OrderPurchasingContext,
  status: OrderStatus,
  /** Store of origin, retained from the Cart; never inferred from region or pricing. */
  storeKey: Schema.optional(StoreKey),
  /** Current recorded order amount, not net money collected after refunds. */
  total: OrderAmount,
  /** Optional merchant workflow observation; its key is not a portable status enum. */
  workflowState: Schema.optional(
    Schema.Struct({ key: Schema.NonEmptyString, label: Schema.NonEmptyString })
  ),
});
export type OrderSummary = typeof OrderSummary.Type;

const orderQuantity = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const OrderLineItemId = Schema.NonEmptyString.pipe(
  Schema.brand("OrderLineItemId")
);
export type OrderLineItemId = typeof OrderLineItemId.Type;

/** Purchased descriptions remain readable without a current catalog Product or Variant. */
export const OrderLineItem = Schema.Struct({
  currentQuantity: Schema.optional(orderQuantity),
  id: OrderLineItemId,
  image: Schema.optional(ProductImage),
  name: Schema.NonEmptyString,
  orderedQuantity: orderQuantity,
  productId: Schema.optional(ProductId),
  sku: Schema.optional(Sku),
  total: Schema.optional(OrderAmount),
  unitPrice: Schema.optional(OrderMoney),
  variantId: Schema.optional(VariantId),
  variantLabel: Schema.optional(Schema.String),
  variantOptions: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))
  ),
});
export type OrderLineItem = typeof OrderLineItem.Type;

/** Historical or redacted address data need not satisfy an editable Address form. */
export const OrderAddress = Schema.Struct({
  addressLine1: Schema.optional(Schema.String),
  addressLine2: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  company: Schema.optional(Schema.String),
  country: Schema.optional(CountryCode),
  postalCode: Schema.optional(Schema.String),
  recipient: Schema.optional(Schema.String),
  region: Schema.optional(Schema.String),
});
export type OrderAddress = typeof OrderAddress.Type;

export const OrderFulfillmentId = Schema.NonEmptyString.pipe(
  Schema.brand("OrderFulfillmentId")
);
export type OrderFulfillmentId = typeof OrderFulfillmentId.Type;

const orderTrackingUrl = Schema.String.check(
  Schema.makeFilter(
    (value) =>
      URL.canParse(value) &&
      ["http:", "https:"].includes(new URL(value).protocol),
    { expected: "an absolute HTTP(S) tracking URL" }
  )
);

export const OrderFulfillment = Schema.Struct({
  deliveryStatus: OrderStatus.fields.delivery,
  id: OrderFulfillmentId,
  lineItems: Schema.Array(
    Schema.Struct({ lineItemId: OrderLineItemId, quantity: orderQuantity })
  ),
  status: OrderStatus.fields.fulfillment,
  tracking: Schema.Array(
    Schema.Struct({
      carrier: Schema.optional(Schema.String),
      number: Schema.optional(Schema.String),
      url: Schema.optional(orderTrackingUrl),
    })
  ),
});
export type OrderFulfillment = typeof OrderFulfillment.Type;

/** Additional accounting observations; the current total is OrderSummary.total. */
export const OrderAmountBreakdown = Schema.Struct({
  discounts: Schema.optional(OrderMoney),
  originalTotal: Schema.optional(OrderAmount),
  outstanding: Schema.optional(OrderMoney),
  /** Collected before refunds; absence is not a zero payment. */
  paidBeforeRefunds: Schema.optional(OrderMoney),
  refunded: Schema.optional(OrderMoney),
  shipping: Schema.optional(OrderAmount),
  subtotal: Schema.optional(OrderAmount),
  tax: Schema.optional(OrderMoney),
});
export type OrderAmountBreakdown = typeof OrderAmountBreakdown.Type;

export const OrderDetail = Schema.Struct({
  ...OrderSummary.fields,
  amounts: OrderAmountBreakdown,
  billingAddress: Schema.optional(OrderAddress),
  cancelledAt: Schema.optional(Schema.DateTimeUtcFromString),
  customerId: Schema.optional(CommerceCustomerId),
  /** Complete collections: adapters must exhaust nested native pagination. */
  fulfillments: Schema.Array(OrderFulfillment),
  lineItems: Schema.Array(OrderLineItem),
  shippingAddress: Schema.optional(OrderAddress),
  updatedAt: Schema.DateTimeUtcFromString,
});
export type OrderDetail = typeof OrderDetail.Type;

/** Continuation only: it never selects a buyer or grants access to an Order. */
export const OrderCursor = Schema.NonEmptyString.pipe(
  Schema.brand("OrderCursor")
);
export type OrderCursor = typeof OrderCursor.Type;

/** Required selection: omission never means either the current Store or all Stores. */
export const OrderStoreSelection = Schema.Union([
  Schema.TaggedStruct("AllStores", {}),
  Schema.TaggedStruct("SingleStore", { storeKey: StoreKey }),
]);
export type OrderStoreSelection = typeof OrderStoreSelection.Type;

/** Exact identifiers, independent statuses and an inclusive-from/exclusive-before UTC range. */
export const OrderFilters = Schema.Struct({
  cancellation: Schema.optional(OrderStatus.fields.cancellation),
  createdBefore: Schema.optional(Schema.DateTimeUtcFromString),
  createdFrom: Schema.optional(Schema.DateTimeUtcFromString),
  fulfillment: Schema.optional(OrderStatus.fields.fulfillment),
  number: Schema.optional(OrderNumber),
  payment: Schema.optional(OrderStatus.fields.payment),
  purchaseOrderNumber: Schema.optional(Schema.NonEmptyString),
}).check(
  Schema.makeFilter(
    ({ createdFrom, createdBefore }) =>
      !createdFrom ||
      !createdBefore ||
      DateTime.isLessThan(createdFrom, createdBefore),
    { expected: "the start of the date range must be before its end" }
  )
);
export type OrderFilters = typeof OrderFilters.Type;

export const ListOrdersInput = Schema.Struct({
  after: Schema.optional(OrderCursor),
  filters: Schema.optional(OrderFilters),
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  locale: CommerceLocale,
  stores: OrderStoreSelection,
});
export type ListOrdersInput = typeof ListOrdersInput.Type;

export const FindOrderDetailInput = Schema.Struct({
  id: OrderId,
  locale: CommerceLocale,
  stores: OrderStoreSelection,
});
export type FindOrderDetailInput = typeof FindOrderDetailInput.Type;

export const OrderPage = Schema.Struct({
  /** Known rolling access limit imposed by the provider, not a shopper-selected date filter. */
  historyLimitDays: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  items: Schema.Array(OrderSummary),
  nextCursor: Schema.optional(OrderCursor),
});
export type OrderPage = typeof OrderPage.Type;

export class OrderQueryFailure extends Schema.TaggedError<OrderQueryFailure>()(
  "OrderQueryFailure",
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
    operation: Schema.Literals(["list", "findById"]),
    reason: Schema.Literals([
      "accessDenied",
      "configuration",
      "invalidCursor",
      "invalidData",
      "unavailable",
    ]),
  }
) {}
