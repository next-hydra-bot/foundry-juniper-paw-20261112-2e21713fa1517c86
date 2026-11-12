import { Effect, Layer, Option } from "effect";

import type { CartOperation } from "../domain/cart-errors";
import {
  CartProviderFailure,
  CurrentCartSelectionConflict,
} from "../domain/cart-errors";
import type { CartSnapshot } from "../domain/cart-snapshot";
import type { CurrentCartCookie } from "../lib/current-cart/cookie";
import { Carts } from "./carts";
import { CommerceContext } from "./commerce-context";
import { CurrentCartStorage } from "./current-cart-storage";

const providerFailureFromAccess = (cause: {
  readonly operation: CartOperation;
}) =>
  new CartProviderFailure({
    cause,
    operation: cause.operation,
    reason: "unexpectedResponse",
  });

/** Existing account-owned cart selection, explicitly selected by the host. */
export const accountCartStorageLayer = (cookie: CurrentCartCookie) =>
  Layer.effect(
    CurrentCartStorage,
    Effect.gen(function* () {
      const carts = yield* Carts;
      const { principal, store } = yield* CommerceContext;
      const isAnonymous = principal._tag === "AnonymousCommercePrincipal";

      const resolve = () =>
        Effect.gen(function* () {
          if (isAnonymous) {
            if (principal.anonymousCartId === undefined) {
              const absent = Option.none<CartSnapshot>();
              return absent;
            }

            const found = yield* carts
              .findById({
                id: principal.anonymousCartId,
                store,
              })
              .pipe(
                Effect.catchTag("CartAccessDenied", (error) =>
                  providerFailureFromAccess(error)
                )
              );
            if (Option.isNone(found)) {
              yield* cookie.clear();
              const absent = Option.none<CartSnapshot>();
              return absent;
            }

            const cart = found.value;
            if (cart.status !== "active" || cart.storeKey !== store.storeKey) {
              yield* cookie.clear();
              const absent = Option.none<CartSnapshot>();
              return absent;
            }
            if (
              cart.buyingContext !== undefined ||
              cart.customerId !== undefined
            ) {
              return yield* new CartProviderFailure({
                operation: "findById",
                reason: "unexpectedResponse",
              });
            }

            return Option.some(cart);
          }

          if (principal._tag === "B2CPurchasingPrincipal") {
            const candidates = yield* carts
              .findActiveForCustomer({
                customerId: principal.customerId,
                store,
              })
              .pipe(
                Effect.catchTag("CartAccessDenied", (error) =>
                  providerFailureFromAccess(error)
                )
              );
            if (candidates.length > 1) {
              return yield* new CurrentCartSelectionConflict({
                cartIds: candidates.map((cart) => cart.id),
              });
            }
            const [cart] = candidates;
            if (cart === undefined) {
              const absent = Option.none<CartSnapshot>();
              return absent;
            }
            if (
              cart.customerId !== principal.customerId ||
              cart.buyingContext !== undefined ||
              cart.storeKey !== store.storeKey ||
              cart.status !== "active"
            ) {
              return yield* new CartProviderFailure({
                operation: "findActiveForCustomer",
                reason: "unexpectedResponse",
              });
            }
            return Option.some(cart);
          }

          const candidates = yield* carts
            .findActiveForBusinessUnit({
              businessUnitId: principal.businessUnitId,
              businessUnitKey: principal.businessUnitKey,
              customerId: principal.customerId,
              store,
            })
            .pipe(
              Effect.catchTag("CartAccessDenied", (error) =>
                providerFailureFromAccess(error)
              )
            );
          if (candidates.length > 1) {
            return yield* new CurrentCartSelectionConflict({
              businessUnitId: principal.businessUnitId,
              cartIds: candidates.map((candidate) => candidate.id),
            });
          }
          const [cart] = candidates;
          if (cart === undefined) {
            const absent = Option.none<CartSnapshot>();

            return absent;
          }
          return Option.some(cart);
        });
      const create = () =>
        Effect.gen(function* () {
          const createForPrincipal = () => {
            if (principal._tag === "AnonymousCommercePrincipal") {
              return carts.createAnonymous({ store });
            }
            if (principal._tag === "B2CPurchasingPrincipal") {
              return carts.createForCustomer({
                customerId: principal.customerId,
                store,
              });
            }
            return carts.createForBusinessUnit({
              businessUnitId: principal.businessUnitId,
              businessUnitKey: principal.businessUnitKey,
              customerId: principal.customerId,
              store,
            });
          };
          const cart = yield* createForPrincipal();
          if (isAnonymous) {
            yield* cookie.set(cart.id);
          }
          return cart;
        });
      return CurrentCartStorage.of({
        addItem: carts.addItem,
        changeDiscountCode: carts.changeDiscountCode,
        create,
        forget: () => (isAnonymous ? cookie.clear() : Effect.void),
        removeLineItem: carts.removeLineItem,
        resolve,
        setLineItemQuantity: carts.setLineItemQuantity,
      });
    })
  );
