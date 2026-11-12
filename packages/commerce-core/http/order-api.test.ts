import { PermissionAdapter } from "@repo/auth-contract/permissions";
import {
  InputInvalid,
  makeInputInvalid,
  makeSchemaErrorIssues,
} from "@repo/errors";
import {
  UnexpectedHttpErrors,
  unexpectedHttpErrorsLayer,
} from "@repo/errors/http";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiMiddleware } from "effect/http-api";
import { describe, expect, it } from "vitest";

import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "../domain/commerce-account";
import {
  AuthUserId,
  AnonymousCommercePrincipal,
  B2CPurchasingPrincipal,
  CustomerCommercePrincipal,
  CommerceRequestContextNotFound,
} from "../domain/commerce-request-context";
import {
  OrderCursor,
  OrderDetail,
  OrderPage,
  OrderQueryFailure,
} from "../domain/order-history";
import type {
  FindOrderDetailInput,
  ListOrdersInput,
} from "../domain/order-history";
import { CommerceContext } from "../services/commerce-context";
import { OrderQueries } from "../services/order-queries";
import { CommerceLocale, resolveStore } from "../store";
import { CommerceRequestHeaders } from "./commerce-request";
import {
  makeOrderApiGroup,
  orderHttpPrograms,
  orderHttpQueriesLayer,
} from "./order-api";

class TestOrderSession extends HttpApiMiddleware.Service<
  TestOrderSession,
  {
    readonly provides: CommerceContext | PermissionAdapter;
    readonly requires: never;
  }
>()("test/OrderHttpSession") {}
class TestOrderSchemaErrors extends HttpApiMiddleware.Service<TestOrderSchemaErrors>()(
  "test/OrderSchemaErrors",
  { error: InputInvalid }
) {}
const api = HttpApi.make("order-contract")
  .add(makeOrderApiGroup(CommerceRequestHeaders).middleware(TestOrderSession))
  .middleware(TestOrderSchemaErrors)
  .middleware(UnexpectedHttpErrors);
const order = Schema.decodeSync(OrderDetail)({
  amounts: {},
  createdAt: "2026-10-20T10:00:00Z",
  fulfillments: [],
  id: "opaque/order:42",
  lineItems: [],
  number: "R-42",
  purchaseOrderNumber: "PO-42",
  purchasingContext: { _tag: "B2COrder" },
  status: {
    cancellation: "notCancelled",
    delivery: "unknown",
    fulfillment: "unfulfilled",
    payment: "paid",
  },
  total: {
    money: { amount: "12.345", currencyCode: "BHD" },
    taxIncluded: "unknown",
  },
  updatedAt: "2026-10-20T10:00:00Z",
});
const fixture = (
  mode: "personal" | "company" | "guest" = "personal",
  reason?: OrderQueryFailure["reason"]
) => {
  const reads: (ListOrdersInput | FindOrderDetailInput)[] = [];
  const principalFor = () => {
    if (mode === "guest") {
      return new AnonymousCommercePrincipal({});
    }
    if (mode === "company") {
      return new CustomerCommercePrincipal({
        authUserId: AuthUserId.make("actor"),
        businessUnitId: CommerceBusinessUnitId.make("unit"),
        businessUnitKey: CommerceBusinessUnitKey.make("unit"),
        customerId: CommerceCustomerId.make("customer"),
        roles: ["buyer"],
      });
    }
    return new B2CPurchasingPrincipal({
      authUserId: AuthUserId.make("actor"),
      customerId: CommerceCustomerId.make("customer"),
    });
  };
  const principal = principalFor();
  const programs = {
    findOrderDetail: (input: FindOrderDetailInput) =>
      Effect.gen(function* () {
        const context = yield* CommerceContext;
        return yield* (yield* OrderQueries).findById(
          yield* context.customerPrincipal(),
          input
        );
      }),
    listOrders: (input: ListOrdersInput) =>
      Effect.gen(function* () {
        if (reason) {
          return yield* new OrderQueryFailure({
            message: "PRIVATE provider detail",
            operation: "list",
            reason,
          });
        }
        const context = yield* CommerceContext;
        return yield* (yield* OrderQueries).list(
          yield* context.customerPrincipal(),
          input
        );
      }),
  };
  const handlers = orderHttpPrograms({ company: programs, personal: programs });
  const transport = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(api).pipe(
      Layer.provide(
        HttpApiBuilder.group(api, "orders", (group) =>
          group
            .handle("list", ({ query }) => handlers.list(query))
            .handle("detail", ({ params, query }) =>
              handlers.detail(params.id, query)
            )
        )
      ),
      Layer.provide(
        Layer.succeed(TestOrderSession, (program) =>
          program.pipe(
            Effect.provideService(CommerceContext, {
              customerPrincipal: () =>
                principal._tag === "AnonymousCommercePrincipal"
                  ? Effect.fail(
                      new CommerceRequestContextNotFound({
                        message: "Guest",
                        reason: "noPrincipal",
                      })
                    )
                  : Effect.succeed(principal),
              customerProfile: () => Effect.die("Unused profile"),
              principal,
              store: resolveStore({ locale: CommerceLocale.make("en-US") }),
            }),
            Effect.provideService(PermissionAdapter, {
              has: () => Effect.succeed(false),
            })
          )
        )
      ),
      Layer.provide(orderHttpQueriesLayer),
      Layer.provide(
        Layer.succeed(OrderQueries, {
          findById: (_principal, input) =>
            Effect.sync(() => {
              reads.push(input);
              return input.id === order.id ? Option.some(order) : Option.none();
            }),
          list: (_principal, input) =>
            Effect.sync(() => {
              reads.push(input);
              return {
                items: [order],
                nextCursor: OrderCursor.make("continuation"),
              };
            }),
        })
      ),
      Layer.provide(
        HttpApiMiddleware.layerSchemaErrorTransform(
          TestOrderSchemaErrors,
          (error) =>
            Effect.fail(
              makeInputInvalid({
                issues: makeSchemaErrorIssues(
                  error.cause,
                  "Invalid Order query."
                ),
                message: "Invalid Order query.",
              })
            )
        )
      ),
      Layer.provide(unexpectedHttpErrorsLayer),
      Layer.provide(HttpServer.layerServices)
    ),
    { disableLogger: true }
  );
  const send = async (path: string) =>
    await transport.handler(
      new Request(`https://api.example${path}`, {
        headers: { "x-context-locale": "en-US" },
      })
    );
  return { reads, send, transport };
};

describe("Order HTTP contract", () => {
  it("decodes explicit cross-Store filters and serializes recorded currency, dates and continuation", async () => {
    const f = fixture();
    try {
      const response = await f.send(
        "/orders?allStores=true&limit=2&number=R-42&purchaseOrderNumber=PO-42&createdFrom=2026-10-01T00:00:00Z&createdBefore=2026-11-01T00:00:00Z&payment=paid"
      );
      expect(response.status).toBe(200);
      const page = Schema.decodeUnknownSync(OrderPage)(await response.json());
      expect(page).toMatchObject({
        items: [
          { total: { money: { amount: "12.345", currencyCode: "BHD" } } },
        ],
        nextCursor: "continuation",
      });
      expect(f.reads[0]).toMatchObject({
        filters: {
          number: "R-42",
          payment: "paid",
          purchaseOrderNumber: "PO-42",
        },
        limit: 2,
        stores: { _tag: "AllStores" },
      });
    } finally {
      await f.transport.dispose();
    }
  });

  it("decodes an opaque ID once and keeps an explicit historical Store independent of locale", async () => {
    const f = fixture("company");
    try {
      const response = await f.send(
        `/orders/${encodeURIComponent(order.id)}?storeKey=historical`
      );
      expect(response.status).toBe(200);
      expect(f.reads[0]).toEqual({
        id: order.id,
        locale: "en-US",
        stores: { _tag: "SingleStore", storeKey: "historical" },
      });
    } finally {
      await f.transport.dispose();
    }
  });

  it.each([
    "",
    "?allStores=true&storeKey=another",
    "?allStores=false",
    "?allStores=true&limit=101",
    "?allStores=true&payment=shipped",
    "?allStores=true&createdFrom=2026-11-01T00:00:00Z&createdBefore=2026-10-01T00:00:00Z",
  ])("rejects an invalid query before reading Orders: %s", async (query) => {
    const f = fixture();
    try {
      const response = await f.send(`/orders${query}`);
      expect(response.status).toBe(400);
      expect(f.reads).toHaveLength(0);
    } finally {
      await f.transport.dispose();
    }
  });

  it.each(["missing", "another-customer"])(
    "uses the same safe not-found response for %s",
    async (id) => {
      const f = fixture();
      try {
        const response = await f.send(`/orders/${id}?allStores=true`);
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
          code: "orders.notFound",
        });
      } finally {
        await f.transport.dispose();
      }
    }
  );

  it.each([
    { mode: "guest", reason: undefined, status: 401 },
    { mode: "company", reason: "accessDenied", status: 403 },
    { mode: "personal", reason: "invalidCursor", status: 400 },
    { mode: "personal", reason: "unavailable", status: 503 },
    { mode: "personal", reason: "configuration", status: 500 },
  ] as const)(
    "preserves safe failure semantics for $mode/$reason",
    async ({ mode, reason, status }) => {
      const f = fixture(mode, reason);
      try {
        const response = await f.send("/orders?allStores=true");
        expect(response.status).toBe(status);
        await expect(response.text()).resolves.not.toContain("PRIVATE");
        expect(f.reads).toHaveLength(0);
      } finally {
        await f.transport.dispose();
      }
    }
  );
});
