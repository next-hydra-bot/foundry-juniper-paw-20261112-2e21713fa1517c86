import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";

import { CommerceLocale } from "../store";
import {
  orderHistoryInput,
  orderHistorySearch,
  orderIdFromRoute,
} from "./history-selection";

describe("Order history URL selection", () => {
  const locale = CommerceLocale.make("fr-FR");

  it.each([
    "gid://shopify/Order/6221847887923",
    "4df346d7-73a8-4f64-9505-372f9a81ce77",
    "order/with%2Fliteral?and=values#fragment",
    "commande-é",
  ])("decodes a page parameter exactly once for opaque Order ID %s", (id) => {
    expect(orderIdFromRoute(encodeURIComponent(id))).toBe(id);
  });

  it.each([undefined, "", "%", "%E0%A4%A"])(
    "rejects an invalid Order route parameter: %s",
    (value) => {
      expect(orderIdFromRoute(value)).toBeNull();
    }
  );

  it("round-trips bookmarkable filters and includes the last UTC calendar day", () => {
    const search = {
      after: "next-page",
      from: "2026-10-20",
      number: " R-1001 ",
      purchaseOrderNumber: "PO & 42",
      status: "fulfilled",
      to: "2026-10-20",
    };
    const input = Option.getOrThrow(
      orderHistoryInput(locale, search, "company")
    );
    expect(input.stores).toEqual({ _tag: "AllStores" });
    expect(
      input.filters?.createdBefore &&
        DateTime.formatIso(input.filters.createdBefore)
    ).toBe("2026-10-21T00:00:00.000Z");
    const query = orderHistorySearch(input);
    expect({
      number: query.get("number"),
      po: query.get("purchaseOrderNumber"),
      status: query.get("status"),
      to: query.get("to"),
    }).toEqual({
      number: "R-1001",
      po: "PO & 42",
      status: "fulfilled",
      to: "2026-10-20",
    });
    expect(
      Option.getOrThrow(
        orderHistoryInput(locale, Object.fromEntries(query), "company")
      )
    ).toEqual(input);
  });

  it.each([
    { from: "2026-02-30" },
    { to: "nonsense" },
    { from: "2026-10-22", to: "2026-10-21" },
    { status: ["fulfilled", "cancelled"] },
    { status: "unknown" },
    { store: "unconfigured-store" },
  ])("rejects invalid URL selection: %j", (search) => {
    expect(
      Option.isNone(orderHistoryInput(locale, search, "company"))
    ).toBeTruthy();
  });

  it("treats blank form controls as no filters and changing filters can start without a cursor", () => {
    const input = Option.getOrThrow(
      orderHistoryInput(
        locale,
        { from: "", number: "", status: "", to: "" },
        "company"
      )
    );
    expect(orderHistorySearch(input).size).toBe(0);
    expect(input.after).toBeUndefined();
  });
});
