import { describe, expect, it } from "@effect/vitest";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  B2CPurchasingPrincipal,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { EmailOrderAccess } from "@repo/commerce-core/domain/order-access";
import {
  FindOrderDetailInput,
  ListOrdersInput,
} from "@repo/commerce-core/domain/order-history";
import {
  OrderId,
  OrderNumber,
} from "@repo/commerce-core/domain/order-identity";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { StoreKey } from "@repo/commerce-core/store";
import { Effect, Option, Redacted, Schema } from "effect";

import type { ShopifyCompanyAdmin } from "../company/admin";
import { orderQueriesLayerWith } from "./queries";

type AdminResponse = Effect.Success<
  ReturnType<ShopifyCompanyAdmin["Service"]["request"]>
>;

const customer = new B2CPurchasingPrincipal({
  authUserId: AuthUserId.make("user"),
  customerId: CommerceCustomerId.make("customer-1"),
});
const company = new CustomerCommercePrincipal({
  authUserId: customer.authUserId,
  businessUnitId: CommerceBusinessUnitId.make("location-1"),
  businessUnitKey: CommerceBusinessUnitKey.make("location-1"),
  customerId: customer.customerId,
  roles: ["buyer"],
});
const input = Schema.decodeUnknownSync(ListOrdersInput)({
  limit: 2,
  locale: "en-US",
  stores: { _tag: "AllStores" },
});
const money = { amount: "12.345", currencyCode: "BHD" };
const bag = { presentmentMoney: money };
const order = (overrides: Record<string, Schema.Json> = {}) => ({
  cancelledAt: null,
  createdAt: "2026-10-20T10:00:00Z",
  currentTotalPriceSet: bag,
  customer: { id: "customer-1" },
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "UNFULFILLED",
  id: "order-1",
  name: "#1001",
  purchasingEntity: { __typename: "Customer" },
  storeAttribution: { type: "single_line_text_field", value: "origin" },
  taxesIncluded: false,
  ...overrides,
});
const pageInfo = { endCursor: null, hasNextPage: false };
const fixture = (
  read: (
    query: string,
    variables: Readonly<Record<string, Schema.Json>>
  ) => Record<string, Schema.Json>,
  accessScopes: readonly string[] = ["read_orders", "read_all_orders"]
) =>
  orderQueriesLayerWith({
    request: (query, variables = {}) =>
      Effect.sync(() =>
        query.includes("OrderHistoryScopes")
          ? {
              currentAppInstallation: {
                accessScopes: accessScopes.map((handle) => ({ handle })),
              },
            }
          : read(query, variables)
      ),
  });

describe("Shopify order history", () => {
  const emailAccess = new EmailOrderAccess({
    orderId: OrderId.make("order-1"),
    recipient: Redacted.make("buyer@example.test", { label: "email" }),
    storeKey: StoreKey.make("origin"),
  });
  const emailInput = Schema.decodeUnknownSync(FindOrderDetailInput)({
    id: "order-1",
    locale: "en-US",
    stores: { _tag: "AllStores" },
  });
  const emailDetail = () => ({
    ...order(),
    billingAddress: null,
    currentShippingPriceSet: bag,
    currentSubtotalPriceSet: bag,
    currentTotalDiscountsSet: bag,
    currentTotalTaxSet: bag,
    email: "buyer@example.test",
    fulfillments: [],
    lineItems: { nodes: [], pageInfo },
    originalTotalPriceSet: bag,
    poNumber: null,
    shippingAddress: null,
    totalOutstandingSet: bag,
    totalReceivedSet: bag,
    totalRefundedSet: bag,
    updatedAt: "2026-10-21T10:00:00Z",
  });
  it.effect(
    "reads personal guest Orders by recorded email even when Shopify created a Customer",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).findById(
          emailAccess,
          emailInput
        );
        expect(Option.getOrThrow(result).id).toBe("order-1");
      }).pipe(
        Effect.provide(
          fixture((query) => {
            expect(query).toContain("email");
            return {
              order: query.includes("OrderHistoryOwnership")
                ? order({ email: "buyer@example.test" })
                : emailDetail(),
            };
          })
        )
      )
  );

  for (const changed of [
    { email: "changed@example.test" },
    {
      purchasingEntity: {
        __typename: "PurchasingCompany",
        location: { id: "location-1" },
      },
    },
    { storeAttribution: { type: "single_line_text_field", value: "other" } },
    { id: "other-order" },
  ]) {
    it.effect(
      `rejects a changed guest Order at both authorization reads: ${Object.keys(changed).join(",")}`,
      () =>
        Effect.gen(function* () {
          const result = yield* (yield* OrderQueries).findById(
            emailAccess,
            emailInput
          );
          expect(Option.isNone(result)).toBeTruthy();
        }).pipe(
          Effect.provide(
            fixture((query) => ({
              order: query.includes("OrderHistoryOwnership")
                ? order({ email: "buyer@example.test" })
                : { ...emailDetail(), ...changed },
            }))
          )
        )
    );
  }

  it.effect(
    "isolates personal orders from company purchases and other customers",
    () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const result = yield* queries.list(customer, input);
        expect(result.items.map((item) => item.id)).toEqual(["order-1"]);
        expect(result.items[0]?.total).toEqual({ money, taxIncluded: "yes" });
      }).pipe(
        Effect.provide(
          fixture(() => ({
            owner: {
              id: "customer-1",
              orders: {
                nodes: [
                  order(),
                  order({
                    id: "company-order",
                    purchasingEntity: {
                      __typename: "PurchasingCompany",
                      location: { id: "location-1" },
                    },
                  }),
                  order({ customer: { id: "other" }, id: "foreign" }),
                ],
                pageInfo,
              },
            },
          }))
        )
      )
  );

  it.effect(
    "uses the selected company location and enforces its ownership on returned records",
    () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const result = yield* queries.list(company, input);
        expect(result.items.map((item) => item.id)).toEqual(["company-order"]);
      }).pipe(
        Effect.provide(
          fixture((query, variables): AdminResponse => {
            expect(query).toContain("owner:companyLocation");
            expect(variables.id).toBe("location-1");
            return {
              owner: {
                id: "location-1",
                orders: {
                  nodes: [
                    order({
                      customer: { id: "colleague" },
                      id: "company-order",
                      purchasingEntity: {
                        __typename: "PurchasingCompany",
                        location: { id: "location-1" },
                      },
                    }),
                    order({
                      id: "foreign",
                      purchasingEntity: {
                        __typename: "PurchasingCompany",
                        location: { id: "location-2" },
                      },
                    }),
                  ],
                  pageInfo,
                },
              },
            };
          })
        )
      )
  );

  it.effect(
    "keeps a continuation for an empty Store-filtered page and rejects reuse in a different context",
    () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const selected = Schema.decodeUnknownSync(ListOrdersInput)({
          ...input,
          stores: { _tag: "SingleStore", storeKey: "other-store" },
        });
        const result = yield* queries.list(customer, selected);
        expect(result.items).toHaveLength(0);
        expect(result.nextCursor).toBeDefined();
        const error = yield* queries
          .list(customer, { ...input, after: result.nextCursor })
          .pipe(Effect.flip);
        expect(error.reason).toBe("invalidCursor");
      }).pipe(
        Effect.provide(
          fixture((_, variables) => ({
            owner: {
              id: "customer-1",
              orders: {
                nodes: [order()],
                pageInfo: {
                  endCursor: `${Schema.decodeUnknownSync(Schema.NullOr(Schema.String))(variables.after) ?? ""}next`,
                  hasNextPage: true,
                },
              },
            },
          }))
        )
      )
  );

  it.effect(
    "matches recorded company PO and Order numbers across native pages",
    () => {
      let calls = 0;
      return Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const selected = Schema.decodeUnknownSync(ListOrdersInput)({
          ...input,
          filters: {
            fulfillment: "unfulfilled",
            number: "#1001",
            payment: "paid",
            purchaseOrderNumber: "PO-42",
          },
        });
        const first = yield* queries.list(company, selected);
        expect(first.items.map((item) => item.id)).toEqual([
          "match-1",
          "match-2",
        ]);
        expect(calls).toBe(2);
        const next = yield* queries.list(company, {
          ...selected,
          after: first.nextCursor,
        });
        expect(next.items.map((item) => item.id)).toEqual(["match-3"]);
        expect(next.nextCursor).toBeUndefined();
      }).pipe(
        Effect.provide(
          fixture((query, variables) => {
            calls += 1;
            expect(query).toContain("owner:companyLocation");
            expect(query).not.toContain("$query");
            expect(variables.id).toBe("location-1");
            const native = (id: string, po = "PO-42") =>
              order({
                customer: { id: "colleague" },
                id,
                poNumber: po,
                purchasingEntity: {
                  __typename: "PurchasingCompany",
                  location: { id: "location-1" },
                },
              });
            const { after } = variables;
            expect(variables.first).toBe(after === "page-1" ? 1 : 2);
            const result = (
              nodes: ReturnType<typeof native>[],
              next: string | null
            ) => ({
              owner: {
                id: Schema.decodeUnknownSync(Schema.String)(variables.id),
                orders: {
                  nodes,
                  pageInfo: { endCursor: next, hasNextPage: next !== null },
                },
              },
            });
            if (after === "page-2") {
              return result([native("match-3")], null);
            }
            if (after === "page-1") {
              return result([native("match-2")], "page-2");
            }
            return result(
              [native("other", "PO-4"), native("match-1")],
              "page-1"
            );
          })
        )
      );
    }
  );

  it.effect(
    "finds a customer order when the search omits its leading hash",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).list(
          customer,
          Schema.decodeUnknownSync(ListOrdersInput)({
            ...input,
            filters: {
              createdBefore: "2026-11-01T00:00:00Z",
              createdFrom: "2026-10-01T00:00:00Z",
              number: "1004",
              payment: "paid",
              purchaseOrderNumber: "PO-42",
            },
          })
        );
        expect(result.items.map((item) => item.id)).toEqual(["order-1"]);
      }).pipe(
        Effect.provide(
          fixture((query, variables) => {
            expect(query).toContain("query:$query");
            expect(variables.query).toContain(
              'created_at:>="2026-10-01T00:00:00.000Z"'
            );
            expect(variables.query).toContain("financial_status:paid");
            expect(variables.query).toContain('(name:"1004" OR name:"#1004")');
            return {
              owner: {
                id: "customer-1",
                orders: {
                  nodes: [
                    order({ name: "#1004", poNumber: "PO-42" }),
                    order({ id: "other", name: "#10040", poNumber: "PO-42" }),
                  ],
                  pageInfo,
                },
              },
            };
          })
        )
      )
  );

  it.effect(
    "keeps a continuation for sparse filtered searches and rejects a different filter",
    () => {
      let calls = 0;
      return Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const selected = Schema.decodeUnknownSync(ListOrdersInput)({
          ...input,
          filters: { purchaseOrderNumber: "missing" },
        });
        const first = yield* queries.list(company, selected);
        expect(first.items).toHaveLength(0);
        expect(first.nextCursor).toBeDefined();
        expect(calls).toBe(5);
        const error = yield* queries
          .list(company, {
            ...selected,
            after: first.nextCursor,
            filters: { number: OrderNumber.make("#1001") },
          })
          .pipe(Effect.flip);
        expect(error.reason).toBe("invalidCursor");
        expect(calls).toBe(5);
      }).pipe(
        Effect.provide(
          fixture(() => {
            calls += 1;
            return {
              owner: {
                id: "location-1",
                orders: {
                  nodes: [],
                  pageInfo: { endCursor: `scan-${calls}`, hasNextPage: true },
                },
              },
            };
          })
        )
      );
    }
  );

  for (const scope of ["read_orders", "write_orders"]) {
    it.effect(`reads recent orders and details with ${scope}`, () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const page = yield* queries.list(customer, input);
        expect(page.items.map((item) => item.id)).toEqual(["order-1"]);
        expect(page.historyLimitDays).toBe(60);
        const detail = yield* queries.findById(customer, emailInput);
        expect(Option.getOrThrow(detail).id).toBe("order-1");
      }).pipe(
        Effect.provide(
          fixture(
            (query): AdminResponse => {
              if (query.includes("OrderHistoryOwnership")) {
                return { order: order() };
              }
              if (query.includes("OrderHistoryDetail")) {
                return { order: emailDetail() };
              }
              return {
                owner: {
                  id: "customer-1",
                  orders: { nodes: [order()], pageInfo },
                },
              };
            },
            [scope]
          )
        )
      )
    );
  }

  it.effect("rejects order reads when the app has no order scope", () =>
    Effect.gen(function* () {
      const queries = yield* OrderQueries;
      const listError = yield* queries.list(customer, input).pipe(Effect.flip);
      const detailError = yield* queries
        .findById(customer, emailInput)
        .pipe(Effect.flip);
      expect(listError.reason).toBe("configuration");
      expect(detailError.reason).toBe("configuration");
    }).pipe(
      Effect.provide(
        fixture(() => {
          throw new Error("Order data must not be read without an order scope");
        }, ["read_products"])
      )
    )
  );

  it.effect(
    "returns None for an order outside the customer scope before reading private details",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).findById(
          customer,
          Schema.decodeUnknownSync(FindOrderDetailInput)({
            id: "order-1",
            locale: "en-US",
            stores: { _tag: "AllStores" },
          })
        );
        expect(Option.isNone(result)).toBeTruthy();
      }).pipe(
        Effect.provide(
          fixture((query) => {
            expect(query).toContain("OrderHistoryOwnership");
            return { order: order({ customer: { id: "someone-else" } }) };
          })
        )
      )
  );

  it.effect(
    "reads historical lines, exact amounts and all line-item pages without a current catalog",
    () =>
      Effect.gen(function* () {
        const result = yield* (yield* OrderQueries).findById(
          customer,
          Schema.decodeUnknownSync(FindOrderDetailInput)({
            id: "order-1",
            locale: "fr-FR",
            stores: { _tag: "AllStores" },
          })
        );
        expect(Option.isSome(result)).toBeTruthy();
        if (Option.isSome(result)) {
          expect(
            result.value.lineItems.every((item) => item.sku === undefined)
          ).toBeTruthy();
          expect(result.value.lineItems.map((item) => item.id)).toEqual([
            "line-1",
            "line-2",
          ]);
          expect(result.value.lineItems[1]?.variantLabel).toBe("M / Red");
        }
      }).pipe(
        Effect.provide(
          fixture((query) => {
            const line = (id: string) => ({
              currentQuantity: 1,
              discountedTotalSet: bag,
              id,
              image: null,
              originalUnitPriceSet: bag,
              product: null,
              quantity: 1,
              sku: "",
              title: "Recorded custom item",
              variant: null,
              variantTitle: null,
            });
            if (query.includes("OrderHistoryOwnership")) {
              return { order: order() };
            }
            if (query.includes("OrderHistoryLines")) {
              return {
                order: {
                  lineItems: {
                    nodes: [{ ...line("line-2"), variantTitle: "M / Red" }],
                    pageInfo,
                  },
                  updatedAt: "2026-10-21T10:00:00Z",
                },
              };
            }
            return {
              order: {
                ...order(),
                billingAddress: null,
                currentShippingPriceSet: bag,
                currentSubtotalPriceSet: bag,
                currentTotalDiscountsSet: bag,
                currentTotalTaxSet: bag,
                fulfillments: [],
                lineItems: {
                  nodes: [line("line-1")],
                  pageInfo: { endCursor: "lines-2", hasNextPage: true },
                },
                originalTotalPriceSet: bag,
                poNumber: null,
                shippingAddress: null,
                totalOutstandingSet: bag,
                totalReceivedSet: bag,
                totalRefundedSet: bag,
                updatedAt: "2026-10-21T10:00:00Z",
              },
            };
          })
        )
      )
  );
  it.effect(
    "exhausts fulfillment pages and preserves their order association",
    () =>
      Effect.gen(function* () {
        const queries = yield* OrderQueries;
        const result = yield* queries.findById(
          customer,
          Schema.decodeUnknownSync(FindOrderDetailInput)({
            id: "order-1",
            locale: "en-US",
            stores: { _tag: "AllStores" },
          })
        );
        expect(Option.isSome(result)).toBeTruthy();
        if (Option.isSome(result)) {
          expect(result.value.fulfillments[0]?.lineItems).toEqual([
            { lineItemId: "line-1", quantity: 1 },
            { lineItemId: "line-2", quantity: 2 },
          ]);
        }
      }).pipe(
        Effect.provide(
          fixture((query, variables): AdminResponse => {
            if (query.includes("OrderHistoryOwnership")) {
              return { order: order() };
            }
            if (query.includes("OrderHistoryFulfillment")) {
              return {
                fulfillment: {
                  fulfillmentLineItems: {
                    nodes: [
                      {
                        lineItem: {
                          id: variables.after === null ? "line-1" : "line-2",
                        },
                        quantity: variables.after === null ? 1 : 2,
                      },
                    ],
                    pageInfo:
                      variables.after === null
                        ? { endCursor: "fulfillment-page-2", hasNextPage: true }
                        : pageInfo,
                  },
                  order: { id: "order-1", updatedAt: "2026-10-21T10:00:00Z" },
                },
              };
            }
            const line = (id: string) => ({
              currentQuantity: 2,
              discountedTotalSet: bag,
              id,
              image: null,
              originalUnitPriceSet: bag,
              product: null,
              quantity: 2,
              sku: null,
              title: "Recorded item",
              variant: null,
              variantTitle: null,
            });
            return {
              order: {
                ...order(),
                billingAddress: null,
                currentShippingPriceSet: bag,
                currentSubtotalPriceSet: bag,
                currentTotalDiscountsSet: bag,
                currentTotalTaxSet: bag,
                fulfillments: [
                  {
                    displayStatus: "IN_TRANSIT",
                    id: "fulfillment-1",
                    status: "SUCCESS",
                    trackingInfo: [],
                  },
                ],
                lineItems: {
                  nodes: [line("line-1"), line("line-2")],
                  pageInfo,
                },
                originalTotalPriceSet: bag,
                poNumber: null,
                shippingAddress: null,
                totalOutstandingSet: bag,
                totalReceivedSet: bag,
                totalRefundedSet: bag,
                updatedAt: "2026-10-21T10:00:00Z",
              },
            };
          })
        )
      )
  );
});
