import "server-only";
import type { AuthenticatedCommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import {
  OrderDetail,
  OrderQueryFailure,
  OrderSummary,
} from "@repo/commerce-core/domain/order-history";
import type {
  FindOrderDetailInput,
  ListOrdersInput,
  OrderStoreSelection,
  OrderStatus,
} from "@repo/commerce-core/domain/order-history";
import { orderCursorCodec } from "@repo/commerce-core/lib/orders/cursor";
import {
  encodeOrderFilters,
  matchesOrderFilters,
} from "@repo/commerce-core/lib/orders/filters";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import type { OrderDetailPrincipal } from "@repo/commerce-core/services/order-queries";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { ShopifyCompanyAdmin } from "../company/admin";
import type { Address } from "./native";
import {
  addressFields,
  Lines,
  lineFields,
  NativeDetail,
  NativeSummary,
  PageInfo,
  summaryFields,
} from "./native";

const fail = (
  operation: "list" | "findById",
  reason: OrderQueryFailure["reason"],
  cause?: unknown
) =>
  new OrderQueryFailure({
    cause,
    message:
      reason === "configuration"
        ? "Order history requires read_orders or write_orders access on the Shopify Admin app."
        : "Shopify orders could not be loaded.",
    operation,
    reason,
  });
const owns = (order: NativeSummary, principal: OrderDetailPrincipal) => {
  if (principal._tag === "EmailOrderAccess") {
    return (
      order.id === principal.orderId &&
      order.purchasingEntity?.__typename !== "PurchasingCompany" &&
      order.storeAttribution?.value === principal.storeKey &&
      order.email === Redacted.value(principal.recipient)
    );
  }
  if (principal._tag === "B2CPurchasingPrincipal") {
    return (
      order.customer?.id === principal.customerId &&
      order.purchasingEntity?.__typename !== "PurchasingCompany"
    );
  }
  return (
    order.purchasingEntity?.__typename === "PurchasingCompany" &&
    order.purchasingEntity.location?.id === principal.businessUnitId
  );
};
const inStore = (order: NativeSummary, stores: OrderStoreSelection) =>
  stores._tag === "AllStores" ||
  order.storeAttribution?.value === stores.storeKey;

const orderNames = (number: string): readonly string[] => {
  const digits = /^#?(?<digits>\d+)$/u.exec(number)?.groups?.digits;
  return digits === undefined ? [number] : [digits, `#${digits}`];
};

const financial = new Map<string, OrderStatus["payment"]>([
  ["AUTHORIZED", "authorized"],
  ["EXPIRED", "expired"],
  ["PAID", "paid"],
  ["PARTIALLY_PAID", "partiallyPaid"],
  ["PARTIALLY_REFUNDED", "partiallyRefunded"],
  ["PENDING", "pending"],
  ["REFUNDED", "refunded"],
  ["VOIDED", "voided"],
]);
const fulfillment = new Map<string, OrderStatus["fulfillment"]>([
  ["FULFILLED", "fulfilled"],
  ["IN_PROGRESS", "inProgress"],
  ["ON_HOLD", "onHold"],
  ["PARTIALLY_FULFILLED", "partiallyFulfilled"],
  ["SCHEDULED", "scheduled"],
  ["UNFULFILLED", "unfulfilled"],
]);
const delivery = new Map<string, OrderStatus["delivery"]>([
  ["ATTEMPTED_DELIVERY", "delayed"],
  ["DELIVERED", "delivered"],
  ["FAILURE", "failed"],
  ["IN_TRANSIT", "inTransit"],
  ["OUT_FOR_DELIVERY", "inTransit"],
  ["READY_FOR_PICKUP", "ready"],
]);
const summaryData = (
  order: NativeSummary,
  principal: OrderDetailPrincipal
) => ({
  createdAt: order.createdAt,
  id: order.id,
  number: order.name,
  purchaseOrderNumber: order.poNumber ?? undefined,
  purchasingContext:
    principal._tag === "CustomerCommercePrincipal"
      ? { _tag: "B2BOrder", businessUnitId: principal.businessUnitId }
      : { _tag: "B2COrder" },
  status: {
    cancellation: order.cancelledAt === null ? "notCancelled" : "cancelled",
    delivery: "unknown",
    fulfillment: fulfillment.get(order.displayFulfillmentStatus) ?? "unknown",
    payment: financial.get(order.displayFinancialStatus ?? "") ?? "unknown",
  },
  storeKey: order.storeAttribution?.value,
  total: {
    money: order.currentTotalPriceSet.presentmentMoney,
    taxIncluded: "yes",
  },
});
const address = (value: typeof Address.Type) =>
  value === null
    ? undefined
    : {
        addressLine1: value.address1 ?? undefined,
        addressLine2: value.address2 ?? undefined,
        city: value.city ?? undefined,
        company: value.company ?? undefined,
        country: value.countryCodeV2 ?? undefined,
        postalCode: value.zip ?? undefined,
        recipient: value.name ?? undefined,
        region: value.province ?? undefined,
      };
const detailFields = `${summaryFields} updatedAt billingAddress { ${addressFields} } shippingAddress { ${addressFields} }
  currentSubtotalPriceSet { presentmentMoney { amount currencyCode } } currentTotalDiscountsSet { presentmentMoney { amount currencyCode } } currentTotalTaxSet { presentmentMoney { amount currencyCode } }
  originalTotalPriceSet { presentmentMoney { amount currencyCode } } totalOutstandingSet { presentmentMoney { amount currencyCode } } totalReceivedSet { presentmentMoney { amount currencyCode } } totalRefundedSet { presentmentMoney { amount currencyCode } } currentShippingPriceSet { presentmentMoney { amount currencyCode } }
  fulfillments { id status displayStatus trackingInfo { company number url } }
  lineItems(first:100) { nodes { ${lineFields} } pageInfo { hasNextPage endCursor } }`;

export const orderQueriesLayerWith = (admin: ShopifyCompanyAdmin["Service"]) =>
  Layer.effect(
    OrderQueries,
    Effect.sync(() => {
      const request = (
        operation: "list" | "findById",
        query: string,
        variables: Readonly<Record<string, Schema.Json>> = {}
      ) =>
        admin
          .request(query, variables)
          .pipe(
            Effect.mapError((cause) => fail(operation, "unavailable", cause))
          );
      const scopes = (operation: "list" | "findById") =>
        Effect.gen(function* () {
          const data = yield* request(
            operation,
            "query OrderHistoryScopes { currentAppInstallation { accessScopes { handle } } }"
          );
          const response = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              currentAppInstallation: Schema.Struct({
                accessScopes: Schema.Array(
                  Schema.Struct({ handle: Schema.String })
                ),
              }),
            })
          )(data).pipe(
            Effect.mapError((cause) => fail(operation, "configuration", cause))
          );
          const granted = new Set(
            response.currentAppInstallation.accessScopes.map(
              (scope) => scope.handle
            )
          );
          if (!(granted.has("read_orders") || granted.has("write_orders"))) {
            return yield* fail(operation, "configuration");
          }
          return granted;
        });
      return OrderQueries.of({
        findById: Effect.fn("ShopifyOrderQueries.findById")(function* (
          principal: OrderDetailPrincipal,
          input: FindOrderDetailInput
        ) {
          yield* scopes("findById");
          // Check ownership before requesting any private address or purchased-item details.
          const initial = yield* request(
            "findById",
            `query OrderHistoryOwnership($id:ID!) { order(id:$id) { ${summaryFields} ${principal._tag === "EmailOrderAccess" ? "email" : ""} } }`,
            { id: input.id }
          );
          const visible = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ order: Schema.NullOr(NativeSummary) })
          )(initial).pipe(
            Effect.mapError((cause) => fail("findById", "invalidData", cause))
          );
          if (
            !visible.order ||
            visible.order.id !== input.id ||
            !owns(visible.order, principal) ||
            !inStore(visible.order, input.stores)
          ) {
            return Option.none<OrderDetail>();
          }
          const response = yield* request(
            "findById",
            `query OrderHistoryDetail($id:ID!) { order(id:$id) { ${detailFields} ${principal._tag === "EmailOrderAccess" ? "email" : ""} } }`,
            { id: input.id }
          );
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ order: Schema.NullOr(NativeDetail) })
          )(response).pipe(
            Effect.mapError((cause) => fail("findById", "invalidData", cause))
          );
          const { order } = decoded;
          if (
            !order ||
            order.id !== input.id ||
            !owns(order, principal) ||
            !inStore(order, input.stores)
          ) {
            return Option.none<OrderDetail>();
          }
          const lines = [...order.lineItems.nodes];
          let page = order.lineItems.pageInfo;
          const cursors = new Set<string>();
          while (page.hasNextPage) {
            if (!page.endCursor || cursors.has(page.endCursor)) {
              return yield* fail("findById", "invalidData");
            }
            cursors.add(page.endCursor);
            const data = yield* request(
              "findById",
              `query OrderHistoryLines($id:ID!,$after:String!) { order(id:$id) { updatedAt lineItems(first:100,after:$after) { nodes { ${lineFields} } pageInfo { hasNextPage endCursor } } } }`,
              { after: page.endCursor, id: input.id }
            );
            const next = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                order: Schema.Struct({
                  lineItems: Lines,
                  updatedAt: Schema.Literal(order.updatedAt),
                }),
              })
            )(data).pipe(
              Effect.mapError((cause) => fail("findById", "invalidData", cause))
            );
            lines.push(...next.order.lineItems.nodes);
            page = next.order.lineItems.pageInfo;
          }
          if (new Set(lines.map((line) => line.id)).size !== lines.length) {
            return yield* fail("findById", "invalidData");
          }
          const fulfillments = yield* Effect.all(
            order.fulfillments.map((item) =>
              Effect.gen(function* () {
                const fulfilled: { lineItemId: string; quantity: number }[] =
                  [];
                let after: string | null = null;
                const seen = new Set<string>();
                while (true) {
                  const data: Record<string, Schema.Json> = yield* request(
                    "findById",
                    "query OrderHistoryFulfillment($id:ID!,$after:String) { fulfillment(id:$id) { order { id updatedAt } fulfillmentLineItems(first:100,after:$after) { nodes { lineItem { id } quantity } pageInfo { hasNextPage endCursor } } } }",
                    { after, id: item.id }
                  );
                  const next = yield* Schema.decodeUnknownEffect(
                    Schema.Struct({
                      fulfillment: Schema.Struct({
                        fulfillmentLineItems: Schema.Struct({
                          nodes: Schema.Array(
                            Schema.Struct({
                              lineItem: Schema.Struct({ id: Schema.String }),
                              quantity: Schema.Int,
                            })
                          ),
                          pageInfo: PageInfo,
                        }),
                        order: Schema.Struct({
                          id: Schema.Literal(order.id),
                          updatedAt: Schema.Literal(order.updatedAt),
                        }),
                      }),
                    })
                  )(data).pipe(
                    Effect.mapError((cause) =>
                      fail("findById", "invalidData", cause)
                    )
                  );
                  const connection = next.fulfillment.fulfillmentLineItems;
                  fulfilled.push(
                    ...connection.nodes.map((line) => ({
                      lineItemId: line.lineItem.id,
                      quantity: line.quantity,
                    }))
                  );
                  if (!connection.pageInfo.hasNextPage) {
                    break;
                  }
                  const end: string | null = connection.pageInfo.endCursor;
                  if (!end || seen.has(end)) {
                    return yield* fail("findById", "invalidData");
                  }
                  seen.add(end);
                  after = end;
                }
                if (
                  new Set(fulfilled.map((line) => line.lineItemId)).size !==
                    fulfilled.length ||
                  fulfilled.some(
                    (line) => !lines.some((item) => item.id === line.lineItemId)
                  )
                ) {
                  return yield* fail("findById", "invalidData");
                }
                return {
                  deliveryStatus:
                    delivery.get(item.displayStatus ?? "") ?? "unknown",
                  id: item.id,
                  lineItems: fulfilled,
                  status: item.status === "SUCCESS" ? "fulfilled" : "unknown",
                  tracking: item.trackingInfo.map((info) => ({
                    carrier: info.company ?? undefined,
                    number: info.number ?? undefined,
                    url: info.url ?? undefined,
                  })),
                };
              })
            )
          );
          const basis = order.taxesIncluded ? "yes" : "no";
          const detail = yield* Schema.decodeUnknownEffect(OrderDetail)({
            ...summaryData(order, principal),
            amounts: {
              discounts: order.currentTotalDiscountsSet.presentmentMoney,
              originalTotal: {
                money: order.originalTotalPriceSet.presentmentMoney,
                taxIncluded: "yes",
              },
              outstanding: order.totalOutstandingSet.presentmentMoney,
              paidBeforeRefunds: order.totalReceivedSet.presentmentMoney,
              refunded: order.totalRefundedSet.presentmentMoney,
              shipping: {
                money: order.currentShippingPriceSet.presentmentMoney,
                taxIncluded: basis,
              },
              subtotal: {
                money: order.currentSubtotalPriceSet.presentmentMoney,
                taxIncluded: basis,
              },
              tax: order.currentTotalTaxSet.presentmentMoney,
            },
            billingAddress: address(order.billingAddress),
            cancelledAt: order.cancelledAt ?? undefined,
            customerId: order.customer?.id,
            fulfillments,
            lineItems: lines.map((line) => ({
              currentQuantity: line.currentQuantity,
              id: line.id,
              image:
                line.image === null
                  ? undefined
                  : {
                      altText: line.image.altText ?? undefined,
                      url: line.image.url,
                    },
              name: line.title,
              orderedQuantity: line.quantity,
              productId: line.product?.id,
              sku: line.sku?.trim() ? line.sku : undefined,
              total: {
                money: line.discountedTotalSet.presentmentMoney,
                taxIncluded: basis,
              },
              unitPrice: line.originalUnitPriceSet.presentmentMoney,
              variantId: line.variant?.id,
              variantLabel: line.variantTitle ?? undefined,
            })),
            shippingAddress: address(order.shippingAddress),
            updatedAt: order.updatedAt,
          }).pipe(
            Effect.mapError((cause) => fail("findById", "invalidData", cause))
          );
          return Option.some(detail);
        }),
        list: Effect.fn("ShopifyOrderQueries.list")(function* (
          principal: AuthenticatedCommercePrincipal,
          input: ListOrdersInput
        ) {
          const cursor = orderCursorCodec(
            "shopify-orders-v1",
            principal,
            input,
            Schema.NonEmptyString
          );
          let after = yield* cursor.decode;
          const granted = yield* scopes("list");
          const historyLimit = granted.has("read_all_orders")
            ? {}
            : { historyLimitDays: 60 };
          const company = principal._tag === "CustomerCommercePrincipal";
          const id = company ? principal.businessUnitId : principal.customerId;
          const { number, ...orderFilters } = input.filters ?? {};
          const names = number === undefined ? undefined : orderNames(number);
          const filters = encodeOrderFilters(orderFilters);
          const search: string[] = [];
          if (names) {
            search.push(
              `(${names.map((name) => `name:${JSON.stringify(name)}`).join(" OR ")})`
            );
          }
          if (filters.createdFrom) {
            search.push(`created_at:>=${JSON.stringify(filters.createdFrom)}`);
          }
          if (filters.createdBefore) {
            search.push(`created_at:<${JSON.stringify(filters.createdBefore)}`);
          }
          if (filters.cancellation === "cancelled") {
            search.push("status:cancelled");
          }
          if (filters.cancellation === "notCancelled") {
            search.push("-status:cancelled");
          }
          const paymentFilter = [...financial].find(
            ([key, value]) => key !== "EXPIRED" && value === filters.payment
          )?.[0];
          if (paymentFilter) {
            search.push(`financial_status:${paymentFilter.toLowerCase()}`);
          }
          const shippingFilter = new Map<OrderStatus["fulfillment"], string>([
            ["fulfilled", "fulfilled"],
            ["partiallyFulfilled", "partial"],
            ["unfulfilled", "unfulfilled"],
            ["onHold", "on_hold"],
            ["scheduled", "scheduled"],
          ]).get(filters.fulfillment ?? "unknown");
          if (shippingFilter) {
            search.push(`fulfillment_status:${shippingFilter}`);
          }
          const items: OrderSummary[] = [];
          const maxPages = 5;
          for (let scan = 0; scan < maxPages; scan += 1) {
            const remaining = input.limit - items.length;
            const variables = {
              after: after ?? null,
              first: remaining,
              id,
            };
            const data = yield* request(
              "list",
              `query OrderHistory($id:ID!,$after:String,$first:Int!${company ? "" : ",$query:String"}) { owner:${company ? "companyLocation" : "customer"}(id:$id) { id orders(first:$first,after:$after,sortKey:CREATED_AT,reverse:true${company ? "" : ",query:$query"}) { nodes { ${summaryFields} } pageInfo { hasNextPage endCursor } } } }`,
              company
                ? variables
                : {
                    ...variables,
                    query: search.length ? search.join(" AND ") : null,
                  }
            );
            const page = yield* Schema.decodeUnknownEffect(
              Schema.Struct({
                owner: Schema.NullOr(
                  Schema.Struct({
                    id: Schema.String,
                    orders: Schema.Struct({
                      nodes: Schema.Array(NativeSummary),
                      pageInfo: PageInfo,
                    }),
                  })
                ),
              })
            )(data).pipe(
              Effect.mapError((cause) => fail("list", "invalidData", cause))
            );
            if (!page.owner || page.owner.id !== id) {
              return yield* fail("list", "accessDenied");
            }
            const summaries = yield* Effect.forEach(
              page.owner.orders.nodes.filter(
                (order) =>
                  owns(order, principal) && inStore(order, input.stores)
              ),
              (order) =>
                Schema.decodeUnknownEffect(OrderSummary)(
                  summaryData(order, principal)
                ).pipe(
                  Effect.mapError((cause) => fail("list", "invalidData", cause))
                )
            );
            items.push(
              ...summaries.filter(
                (order) =>
                  (!names ||
                    (order.number !== undefined &&
                      names.includes(order.number))) &&
                  matchesOrderFilters(order, orderFilters)
              )
            );
            if (items.length > input.limit) {
              return yield* fail("list", "invalidData");
            }
            const continuation = page.owner.orders.pageInfo;
            if (!continuation.hasNextPage) {
              return { ...historyLimit, items };
            }
            if (!continuation.endCursor || continuation.endCursor === after) {
              return yield* fail("list", "invalidData");
            }
            after = continuation.endCursor;
            if (items.length === input.limit || scan === maxPages - 1) {
              return {
                ...historyLimit,
                items,
                nextCursor: cursor.encode(after),
              };
            }
          }
          return { ...historyLimit, items };
        }),
      });
    })
  );
export const orderQueriesLayer = Layer.unwrap(
  ShopifyCompanyAdmin.pipe(Effect.map((admin) => orderQueriesLayerWith(admin)))
).pipe(Layer.provide(ShopifyCompanyAdmin.layer));
