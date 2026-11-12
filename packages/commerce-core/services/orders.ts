import type { PaymentReference } from "@repo/payments";
import { Context, Effect, Layer, Option, Ref } from "effect";

import type { CartId, CartMoney } from "../domain/cart";
import type { CheckoutScope } from "../domain/checkout";
import type {
  OrderId,
  OrderPlacementOutcomeUnknown,
  OrderProviderFailure,
  OrderRecord,
} from "../domain/order";
import {
  OrderPlacementRejected,
  OrderId as OrderIdSchema,
  orderNumberForCart,
} from "../domain/order";

export interface FindOrderInput {
  readonly cartId: CartId;
  readonly scope: CheckoutScope;
}

export interface FindOrderByIdInput {
  readonly anonymousAccess?: {
    readonly cartId: CartId;
    readonly orderId: OrderId;
  };
  readonly id: OrderId;
  readonly scope: CheckoutScope;
}

export interface PlaceOrderInput extends FindOrderInput {
  readonly paymentReference: PaymentReference;
  /** Final payable amount, including all calculated tax. */
  readonly totalPrice: CartMoney;
}

export interface OrdersMemorySeed {
  readonly validationFailure?: OrderPlacementRejected | OrderProviderFailure;
  readonly placeFailure?:
    | OrderPlacementOutcomeUnknown
    | OrderPlacementRejected
    | OrderProviderFailure;
}

const scopeOwner = (scope: CheckoutScope): string => {
  if (scope.channel === "storefrontPersonal") {
    return JSON.stringify([scope.channel, scope.customerId, scope.storeKey]);
  }
  if (scope.channel === "storefrontCustomer") {
    return JSON.stringify([
      scope.channel,
      scope.customerId,
      scope.businessUnitKey,
    ]);
  }
  return scope.channel;
};

export class Orders extends Context.Service<
  Orders,
  {
    readonly find: (
      input: FindOrderInput
    ) => Effect.Effect<Option.Option<OrderRecord>, OrderProviderFailure>;
    readonly findById: (
      input: FindOrderByIdInput
    ) => Effect.Effect<Option.Option<OrderRecord>, OrderProviderFailure>;
    /** Check native orderability before authorizing payment; place rechecks for races. */
    readonly validateCart: (
      input: PlaceOrderInput
    ) => Effect.Effect<void, OrderPlacementRejected | OrderProviderFailure>;
    readonly place: (
      input: PlaceOrderInput
    ) => Effect.Effect<
      OrderRecord,
      | OrderPlacementOutcomeUnknown
      | OrderPlacementRejected
      | OrderProviderFailure
    >;
  }
>()("@repo/commerce-core/Orders") {
  static readonly layerMemory = (seed: OrdersMemorySeed = {}) =>
    Layer.effect(
      Orders,
      Effect.gen(function* () {
        const orders = yield* Ref.make(new Map<CartId, OrderRecord>());
        const owners = yield* Ref.make(new Map<CartId, string>());
        const visibleOrder = (
          order: OrderRecord | undefined,
          scope: CheckoutScope
        ) =>
          Ref.get(owners).pipe(
            Effect.map((current) =>
              order !== undefined &&
              current.get(order.cartId) === scopeOwner(scope)
                ? Option.some(order)
                : Option.none<OrderRecord>()
            )
          );
        return Orders.of({
          validateCart: () =>
            seed.validationFailure === undefined
              ? Effect.void
              : Effect.fail(seed.validationFailure),
          find: Effect.fn("Orders.memory.find")((input) =>
            Ref.get(orders).pipe(
              Effect.flatMap((current) =>
                visibleOrder(current.get(input.cartId), input.scope)
              )
            )
          ),
          findById: Effect.fn("Orders.memory.findById")((input) =>
            Ref.get(orders).pipe(
              Effect.flatMap((current) =>
                visibleOrder(
                  [...current.values()].find((order) => order.id === input.id),
                  input.scope
                )
              )
            )
          ),
          place: Effect.fn("Orders.memory.place")((input) =>
            Effect.gen(function* () {
              const existing = (yield* Ref.get(orders)).get(input.cartId);
              if (existing !== undefined) {
                if (
                  (yield* Ref.get(owners)).get(input.cartId) !==
                  scopeOwner(input.scope)
                ) {
                  return yield* new OrderPlacementRejected({
                    message: "Order belongs to another purchasing context",
                    reason: "cartChanged",
                  });
                }
                return existing;
              }
              if (seed.placeFailure !== undefined) {
                return yield* seed.placeFailure;
              }
              const order: OrderRecord = {
                cartId: input.cartId,
                id: OrderIdSchema.make(`order-${input.cartId}`),
                number: orderNumberForCart(input.cartId),
                paymentReference: input.paymentReference,
                totalPrice: input.totalPrice,
              };
              yield* Ref.update(owners, (current) =>
                new Map(current).set(input.cartId, scopeOwner(input.scope))
              );
              yield* Ref.update(orders, (current) =>
                new Map(current).set(input.cartId, order)
              );
              return order;
            })
          ),
        });
      })
    );
}
