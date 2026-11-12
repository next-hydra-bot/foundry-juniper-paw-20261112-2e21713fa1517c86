import { DateTime, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { OrderFilters, OrderSummary } from "../../domain/order-history";
import { matchesOrderFilters } from "./filters";

const order = Schema.decodeUnknownSync(OrderSummary)({
  createdAt: "2026-10-20T10:00:00Z",
  id: "order-1",
  number: "R-1001",
  purchaseOrderNumber: "PO-42",
  purchasingContext: { _tag: "B2COrder" },
  status: {
    cancellation: "notCancelled",
    delivery: "unknown",
    fulfillment: "fulfilled",
    payment: "balanceDue",
  },
  total: {
    money: { amount: "10.00", currencyCode: "EUR" },
    taxIncluded: "unknown",
  },
});

describe("Order filters", () => {
  it("combines exact identifiers, a UTC range and independent statuses", () => {
    const filters = Schema.decodeUnknownSync(OrderFilters)({
      cancellation: "notCancelled",
      createdBefore: "2026-10-21T00:00:00Z",
      createdFrom: "2026-10-20T10:00:00Z",
      fulfillment: "fulfilled",
      number: "R-1001",
      payment: "balanceDue",
      purchaseOrderNumber: "PO-42",
    });
    expect(matchesOrderFilters(order, filters)).toBeTruthy();
    expect(
      matchesOrderFilters(order, { ...filters, purchaseOrderNumber: "PO-4" })
    ).toBeFalsy();
    expect(
      matchesOrderFilters(order, { ...filters, payment: "paid" })
    ).toBeFalsy();
    expect(
      matchesOrderFilters(order, { createdBefore: order.createdAt })
    ).toBeFalsy();
    expect(
      matchesOrderFilters(order, {
        createdFrom: DateTime.add(order.createdAt, { seconds: 1 }),
      })
    ).toBeFalsy();
  });

  it("rejects inverted ranges and unknown status values", () => {
    expect(() =>
      Schema.decodeUnknownSync(OrderFilters)({
        createdBefore: "2026-10-21T00:00:00Z",
        createdFrom: "2026-10-22T00:00:00Z",
      })
    ).toThrow(/before its end/u);
    expect(() =>
      Schema.decodeUnknownSync(OrderFilters)({ payment: "shipped" })
    ).toThrow(/payment/u);
  });
});
