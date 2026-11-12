import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  FindOrderDetailInput,
  ListOrdersInput,
  OrderDetail,
  OrderMoney,
  OrderPage,
} from "./order-history";

const query = {
  limit: 20,
  locale: "en-US",
  stores: { _tag: "AllStores" },
} as const;

const summary = {
  createdAt: "2026-10-20T10:00:00.000Z",
  id: "order-1",
  purchasingContext: { _tag: "B2COrder" },
  status: {
    cancellation: "notCancelled",
    delivery: "inTransit",
    fulfillment: "partiallyFulfilled",
    payment: "pending",
  },
  total: {
    money: { amount: "12.345", currencyCode: "BHD" },
    taxIncluded: "yes",
  },
};

const detail = {
  ...summary,
  amounts: {},
  fulfillments: [],
  lineItems: [
    {
      currentQuantity: 1,
      id: "line-1",
      name: "Recorded custom item",
      orderedQuantity: 2,
      unitPrice: { amount: "7.12345678901234567890", currencyCode: "BHD" },
    },
  ],
  shippingAddress: { addressLine1: "14 High Street", country: "BH" },
  updatedAt: "2026-10-21T12:00:00.000Z",
};

describe("Order history read schemas", () => {
  it.each([
    { _tag: "AllStores" },
    { _tag: "SingleStore", storeKey: "requested-store" },
  ])("accepts $_tag independently of presentation locale", (stores) => {
    const input = { ...query, locale: "fr-FR", stores };
    const decoded = Schema.decodeUnknownSync(ListOrdersInput)(input);
    expect(Schema.encodeSync(ListOrdersInput)(decoded)).toEqual(input);
    const detailInput = { id: "order-1", locale: "fr-FR", stores };
    const detailQuery =
      Schema.decodeUnknownSync(FindOrderDetailInput)(detailInput);
    expect(Schema.encodeSync(FindOrderDetailInput)(detailQuery)).toEqual(
      detailInput
    );
  });

  it.each([
    { amount: "1234", currencyCode: "JPY" },
    { amount: "12.345", currencyCode: "BHD" },
    { amount: "0.12345678901234567890", currencyCode: "EUR" },
  ])(
    "preserves the exact recorded amount and currency: $currencyCode",
    (money) => {
      const decoded = Schema.decodeSync(OrderMoney)(money);
      expect(Schema.encodeSync(OrderMoney)(decoded)).toEqual(money);
    }
  );

  it("reads historical custom merchandise, partial addresses and unknown accounting without catalog or payment references", () => {
    const order = Schema.decodeUnknownSync(OrderDetail)(detail);
    expect(Schema.encodeSync(OrderDetail)(order)).toEqual(detail);
    expect(order.amounts.paidBeforeRefunds).toBeUndefined();
    expect(order.lineItems[0]).toMatchObject({
      currentQuantity: 1,
      orderedQuantity: 2,
    });
  });

  it("keeps company ownership and financial, fulfillment and delivery observations independent", () => {
    const order = Schema.decodeUnknownSync(OrderDetail)({
      ...detail,
      purchaseOrderNumber: "PO-42",
      purchasingContext: { _tag: "B2BOrder", businessUnitId: "unit-1" },
    });
    expect(order.purchasingContext).toEqual({
      _tag: "B2BOrder",
      businessUnitId: "unit-1",
    });
    expect(order.status).toEqual(summary.status);
  });

  it("retains a recorded Store independently of shipping country and order currency", () => {
    const order = Schema.decodeUnknownSync(OrderDetail)({
      ...detail,
      shippingAddress: { addressLine1: "14 High Street", country: "GB" },
      storeKey: "europe-store",
      total: {
        money: { amount: "20.00", currencyCode: "GBP" },
        taxIncluded: "yes",
      },
    });
    expect(order.storeKey).toBe("europe-store");
    expect(order.total.money.currencyCode).toBe("GBP");
    expect(
      Schema.decodeUnknownSync(OrderDetail)(detail).storeKey
    ).toBeUndefined();
  });

  it("continues a filtered page without inventing an exact total or a missing display number", () => {
    const read = Schema.decodeUnknownSync(OrderPage);
    expect(read({ items: [], nextCursor: "opaque-continuation" })).toEqual({
      items: [],
      nextCursor: "opaque-continuation",
    });
    const page = read({ items: [summary] });
    expect(page.items[0]?.number).toBeUndefined();
  });

  it.each([0, 101, 1.5])(
    "rejects an invalid requested page size: %s",
    (limit) => {
      expect(() =>
        Schema.decodeSync(ListOrdersInput)({ ...query, limit })
      ).toThrow(/limit/u);
    }
  );

  it("rejects floating-point input and unclassified status values at the read boundary", () => {
    expect(() =>
      Schema.decodeUnknownSync(OrderMoney)({
        amount: 12.345,
        currencyCode: "BHD",
      })
    ).toThrow(/amount/u);
    expect(() =>
      Schema.decodeUnknownSync(OrderDetail)({
        ...detail,
        status: { ...summary.status, payment: "settled-somehow" },
      })
    ).toThrow(/payment/u);
  });
});
