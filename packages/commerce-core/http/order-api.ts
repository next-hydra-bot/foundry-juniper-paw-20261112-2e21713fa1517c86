import type {
  PermissionAdapter,
  PermissionCheckFailure,
} from "@repo/auth-contract/permissions";
import {
  definePublicError,
  InputInvalid,
  makeInputInvalid,
  makeSchemaErrorIssues,
} from "@repo/errors";
import { Effect, Layer, Option, Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  OpenApi,
} from "effect/http-api";

import type { CommerceRequestContextNotFound } from "../domain/commerce-request-context";
import {
  ListOrdersInput,
  OrderCursor,
  OrderDetail,
  OrderFilters,
  OrderPage,
} from "../domain/order-history";
import type {
  OrderQueryFailure,
  FindOrderDetailInput,
} from "../domain/order-history";
import { OrderId } from "../domain/order-identity";
import { CommerceContext } from "../services/commerce-context";
import { OrderQueries } from "../services/order-queries";
import { StoreKey } from "../store";

const unauthorized = definePublicError({
  category: "unauthenticated",
  code: "auth.unauthorized",
  fields: {},
  recovery: "reauthenticate",
  status: 401,
  tag: "OrderApiUnauthorized",
});
const forbidden = definePublicError({
  category: "forbidden",
  code: "orders.accessDenied",
  fields: {},
  recovery: "request_access",
  status: 403,
  tag: "OrderApiForbidden",
});
const missing = definePublicError({
  category: "not_found",
  code: "orders.notFound",
  fields: {},
  recovery: "none",
  status: 404,
  tag: "OrderApiNotFound",
});
const unavailable = definePublicError({
  category: "unavailable",
  code: "orders.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "OrderApiUnavailable",
});

type OrderReadServices = CommerceContext | OrderQueries | PermissionAdapter;
type OrderReadFailure =
  | OrderQueryFailure
  | PermissionCheckFailure
  | CommerceRequestContextNotFound;
/** Recipes supply the existing owning-domain programs, without provider selection in Core. */
export interface OrderReadPrograms {
  readonly listOrders: (
    input: ListOrdersInput
  ) => Effect.Effect<OrderPage, OrderReadFailure, OrderReadServices>;
  readonly findOrderDetail: (
    input: FindOrderDetailInput
  ) => Effect.Effect<
    Option.Option<OrderDetail>,
    OrderReadFailure,
    OrderReadServices
  >;
}
export interface OrderHttpPrograms {
  readonly personal?: OrderReadPrograms;
  readonly company?: OrderReadPrograms;
}

const StoreQuery = Schema.Struct({
  allStores: Schema.optional(Schema.Literal("true")),
  storeKey: Schema.optional(StoreKey),
}).check(
  Schema.makeFilter(
    (query) => (query.allStores === "true") !== (query.storeKey !== undefined),
    { expected: "select allStores=true or storeKey, exclusively" }
  )
);
export const OrderListQuery = Schema.Struct({
  ...OrderFilters.fields,
  ...StoreQuery.fields,
  after: Schema.optional(OrderCursor),
  limit: Schema.optional(
    Schema.FiniteFromString.check(
      Schema.isInt(),
      Schema.isBetween({ maximum: 100, minimum: 1 })
    )
  ),
}).check(
  Schema.makeFilter(
    (query) => (query.allStores === "true") !== (query.storeKey !== undefined),
    { expected: "select allStores=true or storeKey, exclusively" }
  )
);

const invalidInput = (cause: Schema.SchemaError) =>
  makeInputInvalid({
    issues: makeSchemaErrorIssues(cause, "The Order query is invalid."),
    message: "The Order query is invalid.",
  });
const readFailure = (
  error: OrderReadFailure
): Effect.Effect<
  never,
  InputInvalid | typeof forbidden.schema.Type | typeof unavailable.schema.Type
> => {
  if (
    error._tag === "CommerceRequestContextNotFound" ||
    (error._tag === "OrderQueryFailure" && error.reason === "accessDenied")
  ) {
    return Effect.fail(
      forbidden.make({ message: "This Order history is inaccessible." })
    );
  }
  if (error._tag === "OrderQueryFailure" && error.reason === "invalidCursor") {
    return Effect.fail(
      makeInputInvalid({
        issues: [
          {
            message: "The cursor does not match this Order query.",
            path: ["after"],
          },
        ],
        message: "Start from the first Order page with these filters.",
      })
    );
  }
  return error.reason === "unavailable"
    ? Effect.fail(
        unavailable.make({
          message: "Order history is temporarily unavailable.",
        })
      )
    : Effect.die(error);
};
const stores = (query: typeof StoreQuery.Type) =>
  query.storeKey === undefined
    ? { _tag: "AllStores" as const }
    : { _tag: "SingleStore" as const, storeKey: query.storeKey };

/** Identity comes only from verified middleware. Email grants cannot enter this API. */
export const orderHttpPrograms = (programs: OrderHttpPrograms) => {
  const reader = Effect.gen(function* () {
    const { principal } = yield* CommerceContext;
    if (principal._tag === "AnonymousCommercePrincipal") {
      return yield* Effect.fail(
        unauthorized.make({ message: "Sign in to read Order history." })
      );
    }
    const selected =
      principal._tag === "B2CPurchasingPrincipal"
        ? programs.personal
        : programs.company;
    if (!selected) {
      return yield* Effect.fail(
        forbidden.make({
          message: "This buying context does not expose Order history.",
        })
      );
    }
    return selected;
  });
  return {
    detail: (id: OrderId, query: typeof StoreQuery.Type) =>
      Effect.gen(function* () {
        const selected = yield* reader;
        const context = yield* CommerceContext;
        const result = yield* selected
          .findOrderDetail({
            id,
            locale: context.store.locale,
            stores: stores(query),
          })
          .pipe(Effect.catch(readFailure));
        if (Option.isNone(result)) {
          return yield* Effect.fail(
            missing.make({ message: "Order not found." })
          );
        }
        return result.value;
      }),
    list: (query: typeof OrderListQuery.Type) =>
      Effect.gen(function* () {
        const selected = yield* reader;
        const context = yield* CommerceContext;
        const input = yield* Schema.decodeEffect(
          Schema.toType(ListOrdersInput)
        )({
          after: query.after,
          filters: query,
          limit: query.limit ?? 20,
          locale: context.store.locale,
          stores: stores(query),
        }).pipe(Effect.mapError(invalidInput));
        return yield* selected
          .listOrders(input)
          .pipe(Effect.catch(readFailure));
      }),
  };
};

/** Bind the stable provider reader into the HTTP request dependency scope. */
export class OrderHttpQueries extends HttpApiMiddleware.Service<
  OrderHttpQueries,
  { readonly provides: OrderQueries; readonly requires: never }
>()("@repo/commerce-core/http/OrderQueries", {}) {}
export const orderHttpQueriesLayer = Layer.effect(
  OrderHttpQueries,
  Effect.gen(function* () {
    const queries = yield* OrderQueries;
    return OrderHttpQueries.of((program) =>
      program.pipe(Effect.provideService(OrderQueries, queries))
    );
  })
);

/** Providers apply their verified request-context middleware and mount this only through their API recipe. */
export const makeOrderApiGroup = <Headers extends Schema.Top>(
  headers: Headers
) =>
  HttpApiGroup.make("orders")
    .add(
      HttpApiEndpoint.get("list", "/orders", {
        error: [
          InputInvalid,
          unauthorized.schema,
          forbidden.schema,
          unavailable.schema,
        ],
        headers,
        query: OrderListQuery,
        success: OrderPage,
      }).annotate(
        OpenApi.Summary,
        "List authorized personal or selected-company Orders"
      )
    )
    .add(
      HttpApiEndpoint.get("detail", "/orders/:id", {
        error: [
          InputInvalid,
          unauthorized.schema,
          forbidden.schema,
          missing.schema,
          unavailable.schema,
        ],
        headers,
        params: Schema.Struct({ id: OrderId }),
        query: StoreQuery,
        success: OrderDetail,
      }).annotate(OpenApi.Summary, "Read an authorized Order by its opaque ID")
    )
    .middleware(OrderHttpQueries);
