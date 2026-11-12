import { Option, Schema } from "effect";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FindOrderDetailInput, OrderDetail } from "../domain/order-history";
import { OrderDetailView } from "./pages";

describe("email Order detail", () => {
  it("renders a standalone receipt for email access without account navigation", () => {
    const order = Schema.decodeSync(Schema.toCodecJson(OrderDetail))({
      amounts: {},
      createdAt: "2026-11-01T10:00:00Z",
      fulfillments: [],
      id: "opaque-order",
      lineItems: [
        { id: "line-1", name: "Recorded purchase", orderedQuantity: 2 },
      ],
      number: "R-1001",
      purchasingContext: { _tag: "B2COrder" },
      status: {
        cancellation: "notCancelled",
        delivery: "unknown",
        fulfillment: "unfulfilled",
        payment: "paid",
      },
      total: {
        money: { amount: "12.345", currencyCode: "BHD" },
        taxIncluded: "yes",
      },
      updatedAt: "2026-11-01T10:00:00Z",
    });
    const input = Schema.decodeSync(FindOrderDetailInput)({
      id: "opaque-order",
      locale: "en-US",
      stores: { _tag: "AllStores" },
    });
    const html = renderToStaticMarkup(
      <OrderDetailView
        emailAccess
        input={input}
        locale="en-US"
        result={{ value: Option.some(order) }}
        t={(key) => key}
      />
    );
    expect(html).toContain("Recorded purchase");
    expect(html).toContain("R-1001");
    expect(html).toContain("12.345");
    expect(html).not.toContain("/account");
  });
});
