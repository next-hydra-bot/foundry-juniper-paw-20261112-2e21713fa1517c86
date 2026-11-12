import messages from "@repo/i18n/messages/en-US.json";
import { Option, Schema } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  FindOrderDetailInput,
  ListOrdersInput,
  OrderDetail,
  OrderPage,
} from "../domain/order-history";
import { orderHistoryInput, orderHistorySearch } from "./history-selection";
import type { OrderHistoryMode } from "./history-selection";
import { OrderDetailView, OrderListingView, orderIdFromRoute } from "./pages";

const roots: ReturnType<typeof createRoot>[] = [];
const t = (key: string) => {
  const text = messages.web.orderHistory;
  const labels = new Map<string, string>([
    ...Object.entries(text).filter((entry): entry is [string, string] =>
      Schema.is(Schema.String)(entry[1])
    ),
    ...Object.entries(text.status).map(([name, label]): [string, string] => [
      `status.${name}`,
      label,
    ]),
  ]);
  return labels.get(key) ?? key;
};
const listingInput = Schema.decodeUnknownSync(ListOrdersInput)({
  limit: 20,
  locale: "en-US",
  stores: { _tag: "SingleStore", storeKey: "default-store" },
});
const detailInput = Schema.decodeUnknownSync(FindOrderDetailInput)({
  id: "gid://order/1",
  locale: "en-US",
  stores: { _tag: "AllStores" },
});
const summary = {
  createdAt: "2026-10-20T10:00:00Z",
  id: "gid://order/1",
  number: "#1001",
  purchasingContext: { _tag: "B2COrder" },
  status: {
    cancellation: "notCancelled",
    delivery: "unknown",
    fulfillment: "unfulfilled",
    payment: "paid",
  },
  storeKey: "default-store",
  total: {
    money: { amount: "12.345", currencyCode: "BHD" },
    taxIncluded: "yes",
  },
};

const mountHistory = (
  input: ListOrdersInput,
  mode: OrderHistoryMode = "company"
) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (selection: ListOrdersInput) => {
    act(() => {
      root.render(
        <OrderListingView
          locale="en-US"
          mode={mode}
          input={selection}
          t={t}
          result={{ value: { items: [] } }}
        />
      );
    });
  };
  const form = () => {
    const element = container.querySelector("form");
    if (!element) {
      throw new Error("Expected the Order history search form");
    }
    return element;
  };
  render(input);
  return { form, render };
};

describe("order pages", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("reflects the active URL selection when filters are cleared during client navigation", () => {
    const active = Option.getOrThrow(
      orderHistoryInput(
        listingInput.locale,
        {
          number: "R-1001",
          purchaseOrderNumber: "PO-42",
          from: "2026-10-20",
          to: "2026-10-21",
          status: "fulfilled",
        },
        "company"
      )
    );
    const { form, render } = mountHistory(active);
    expect(Object.fromEntries(new FormData(form()))).toMatchObject({
      status: "fulfilled",
      number: "R-1001",
      to: "2026-10-21",
    });
    render(
      Option.getOrThrow(orderHistoryInput(listingInput.locale, {}, "company"))
    );
    expect(Object.fromEntries(new FormData(form()))).toMatchObject({
      number: "",
      purchaseOrderNumber: "",
      from: "",
      to: "",
      status: "",
    });
  });

  it("accepts editing an applied date range to an earlier valid range", () => {
    const active = Option.getOrThrow(
      orderHistoryInput(
        listingInput.locale,
        {
          from: "2026-10-20",
          to: "2026-10-21",
        },
        "company"
      )
    );
    const { form } = mountHistory(active);
    const start = form().querySelector<HTMLInputElement>('[name="from"]');
    const end = form().querySelector<HTMLInputElement>('[name="to"]');
    if (!start || !end) {
      throw new Error("Expected the Order date controls");
    }
    start.value = "2026-10-01";
    end.value = "2026-10-05";
    expect(form().checkValidity()).toBeTruthy();
    const selected = Option.getOrThrow(
      orderHistoryInput(
        listingInput.locale,
        Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
          Object.fromEntries(new FormData(form()))
        ),
        "company"
      )
    );
    expect(Object.fromEntries(orderHistorySearch(selected))).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
  });

  it("searches personal orders across Stores with only an order number and status", () => {
    const input = Option.getOrThrow(
      orderHistoryInput(
        listingInput.locale,
        {
          from: "2026-10-20",
          number: "R-1001",
          purchaseOrderNumber: "PO-42",
          status: "cancelled",
          store: "company-store",
        },
        "personal"
      )
    );
    const { form } = mountHistory(input, "personal");
    expect(Object.fromEntries(new FormData(form()))).toEqual({
      number: "R-1001",
      status: "cancelled",
    });
    expect(input.stores).toEqual({ _tag: "AllStores" });
    expect(input.filters?.cancellation).toBe("cancelled");
    expect(Object.fromEntries(orderHistorySearch(input))).toEqual({
      number: "R-1001",
      status: "cancelled",
    });
  });

  it("renders an explicit Store selector, original currency and encoded detail links", () => {
    const html = renderToStaticMarkup(
      <OrderListingView
        locale="en-US"
        mode="company"
        input={listingInput}
        t={t}
        result={{
          value: Schema.decodeUnknownSync(OrderPage)({
            items: [summary],
            nextCursor: "next-page",
          }),
        }}
      />
    );
    expect(html).toContain("BHD");
    expect(html).toContain("12.345");
    expect(html).toContain("gid%3A%2F%2Forder%2F1");
    const document = new DOMParser().parseFromString(html, "text/html");
    const link = document.querySelector("tbody a")?.getAttribute("href");
    const routeId = new URL(link ?? "", "https://shop.example").pathname
      .split("/")
      .at(-1);
    expect(orderIdFromRoute(routeId)).toBe(summary.id);
    expect(html).toContain("after=next-page");
  });

  it("distinguishes a filtered page from the end of order history", () => {
    const html = renderToStaticMarkup(
      <OrderListingView
        locale="en-US"
        mode="company"
        input={listingInput}
        t={t}
        result={{
          value: Schema.decodeUnknownSync(OrderPage)({
            items: [],
            nextCursor: "next",
          }),
        }}
      />
    );
    expect(html).toContain("No matching orders found yet");
    expect(html).toContain("Continue searching");
  });

  it("preserves filters in detail and pagination links while the search form starts a fresh page", () => {
    const input = Schema.decodeUnknownSync(ListOrdersInput)({
      ...listingInput,
      after: "current-page",
      filters: {
        number: "R-1001",
        purchaseOrderNumber: "PO & 42",
        cancellation: "notCancelled",
        fulfillment: "unfulfilled",
        createdFrom: "2026-10-20T00:00:00Z",
        createdBefore: "2026-10-22T00:00:00Z",
      },
    });
    const html = renderToStaticMarkup(
      <OrderListingView
        locale="en-US"
        mode="company"
        input={input}
        t={t}
        result={{
          value: Schema.decodeUnknownSync(OrderPage)({
            items: [
              { ...summary, number: "R-1001", purchaseOrderNumber: "PO & 42" },
            ],
            nextCursor: "next-page",
          }),
        }}
      />
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    const form = document.querySelector("form");
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    expect(values).toMatchObject({
      number: "R-1001",
      purchaseOrderNumber: "PO & 42",
      from: "2026-10-20",
      to: "2026-10-21",
      status: "unfulfilled",
    });
    expect(form?.querySelector('[name="after"]')).toBeNull();
    const detail = new URL(
      document.querySelector("tbody a")?.getAttribute("href") ?? "",
      "https://example.test"
    );
    const next = new URL(
      [...document.querySelectorAll("a")]
        .find((link) => link.textContent === "Next page")
        ?.getAttribute("href") ?? "",
      "https://example.test"
    );
    expect(Object.fromEntries(detail.searchParams)).toMatchObject({
      after: "current-page",
      number: "R-1001",
      purchaseOrderNumber: "PO & 42",
      from: "2026-10-20",
      to: "2026-10-21",
      status: "unfulfilled",
    });
    expect(Object.fromEntries(next.searchParams)).toEqual({
      ...Object.fromEntries(detail.searchParams),
      after: "next-page",
    });
  });

  it("keeps already-applied discounts and refunds separate from the native total", () => {
    const order = Schema.decodeUnknownSync(OrderDetail)({
      ...summary,
      total: {
        money: { amount: "81.00", currencyCode: "USD" },
        taxIncluded: "yes",
      },
      amounts: {
        subtotal: {
          money: { amount: "75.00", currencyCode: "USD" },
          taxIncluded: "no",
        },
        tax: { amount: "6.00", currencyCode: "USD" },
        discounts: { amount: "10.00", currencyCode: "USD" },
        refunded: { amount: "5.00", currencyCode: "USD" },
      },
      fulfillments: [],
      lineItems: [],
      updatedAt: summary.createdAt,
    });
    const html = renderToStaticMarkup(
      <OrderDetailView
        locale="en-US"
        input={detailInput}
        history={listingInput}
        t={t}
        result={{ value: Option.some(order) }}
      />
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    const adjustments = document.querySelector(
      `section[aria-label="${t("adjustments")}"]`
    );
    expect(adjustments?.textContent).toContain(t("discountsApplied"));
    expect(adjustments?.textContent).toContain("10.00");
    expect(adjustments?.textContent).toContain("5.00");
    const totals = adjustments?.previousElementSibling;
    expect(totals?.textContent).toContain("75.00");
    expect(totals?.textContent).toContain("81.00");
  });

  it("renders historical custom items, full street address and recorded totals", () => {
    const order = Schema.decodeUnknownSync(OrderDetail)({
      ...summary,
      amounts: {},
      fulfillments: [],
      lineItems: [
        { id: "custom", name: "Recorded service", orderedQuantity: 2 },
        {
          id: "jacket",
          name: "Recorded jacket",
          orderedQuantity: 1,
          variantLabel: "L / Blue",
          variantOptions: [
            { name: "Size", value: "L" },
            { name: "Color", value: "Blue" },
          ],
        },
      ],
      shippingAddress: { addressLine1: "14 High Street" },
      updatedAt: "2026-10-21T10:00:00Z",
    });
    const html = renderToStaticMarkup(
      <OrderDetailView
        locale="en-US"
        input={detailInput}
        history={Schema.decodeUnknownSync(ListOrdersInput)({
          ...listingInput,
          after: "current-page",
          filters: { purchaseOrderNumber: "PO-42", cancellation: "cancelled" },
        })}
        t={t}
        result={{ value: Option.some(order) }}
      />
    );
    expect(html).toContain("Recorded service");
    const document = new DOMParser().parseFromString(html, "text/html");
    const descriptions = Object.fromEntries(
      [...document.querySelectorAll("dt")].map((label) => [
        label.textContent,
        label.nextElementSibling?.textContent,
      ])
    );
    expect(descriptions).toMatchObject({ "Color:": "Blue", "Size:": "L" });
    expect(html).toContain("14 High Street");
    expect(html).toContain("12.345");
    expect(html).toContain(
      "after=current-page&amp;purchaseOrderNumber=PO-42&amp;status=cancelled"
    );
  });

  it("returns the same not-found outcome for missing and inaccessible detail IDs", () => {
    expect(() =>
      renderToStaticMarkup(
        <OrderDetailView
          locale="en-US"
          input={detailInput}
          t={t}
          result={{ value: Option.none() }}
        />
      )
    ).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("explains a provider history window even when no recent orders are available", () => {
    const translate = vi.fn<typeof t>(t);
    const html = renderToStaticMarkup(
      <OrderListingView
        locale="en-US"
        mode="company"
        input={{ ...listingInput, stores: { _tag: "AllStores" } }}
        t={translate}
        result={{ value: { historyLimitDays: 60, items: [] } }}
      />
    );
    expect(translate).toHaveBeenCalledWith("historyLimit", { days: 60 });
    expect(html).toContain(messages.web.orderHistory.emptyRecent);
  });

  it("shows a read failure instead of presenting an empty purchase history", () => {
    const html = renderToStaticMarkup(
      <OrderListingView
        locale="en-US"
        mode="company"
        input={listingInput}
        t={t}
        result={{ error: "unavailable" }}
      />
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(messages.web.orderHistory.unavailable);
    expect(html).not.toContain(messages.web.orderHistory.empty);
  });
});
