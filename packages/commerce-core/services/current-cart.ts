import type {
  LineItemId,
  PositiveCartQuantity,
  VariantId,
} from "@repo/commerce-core/domain/cart";
import { CurrentCartUnavailable } from "@repo/commerce-core/domain/cart-errors";
import type {
  CartProviderFailure,
  CartMutationRejected,
  CartLineItemNotFound,
  CartMerchandiseUnavailable,
  CartPolicyFailure,
  CartWriteConflict,
  CartWriteOutcomeUnknown,
  CurrentCartOperationFailure,
  CurrentCartSelectionConflict,
} from "@repo/commerce-core/domain/cart-errors";
import type {
  CartSnapshot,
  CartTarget,
  CurrentCartState,
} from "@repo/commerce-core/domain/cart-snapshot";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Context, Effect, Layer, Option, Ref } from "effect";

import type { ChangeDiscountCode } from "../domain/promotions";
import type { CurrentCartCookie } from "../lib/current-cart/cookie";
import { accountCartStorageLayer } from "./account-cart-storage";
import { CartPolicies } from "./cart-policies";
import { CurrentCartStorage } from "./current-cart-storage";

const unavailable = <A, E>(
  effect: Effect.Effect<
    A,
    E | { readonly _tag: "CartNotFound" | "CartAccessDenied" }
  >
) =>
  effect.pipe(
    Effect.catchTags({
      CartAccessDenied: () =>
        new CurrentCartUnavailable({ reason: "inaccessibleCart" }),
      CartNotFound: () => new CurrentCartUnavailable({ reason: "noCart" }),
    })
  );

export interface AddCurrentCartItem {
  readonly quantity: PositiveCartQuantity;
  readonly variantId: VariantId;
}

export interface SetCurrentCartLineItemQuantity {
  readonly lineItemId: LineItemId;
  readonly quantity: PositiveCartQuantity;
}

export interface RemoveCurrentCartLineItem {
  readonly lineItemId: LineItemId;
}

export type CurrentCartReadFailure =
  | CurrentCartSelectionConflict
  | CartProviderFailure
  | CartPolicyFailure;

export type AddCurrentCartItemFailure =
  | CurrentCartSelectionConflict
  | CurrentCartUnavailable
  | CartMutationRejected
  | CartMerchandiseUnavailable
  | CartWriteConflict
  | CartWriteOutcomeUnknown
  | CurrentCartOperationFailure
  | CartProviderFailure
  | CartPolicyFailure;

export type SetCurrentCartLineItemQuantityFailure =
  | CurrentCartSelectionConflict
  | CurrentCartUnavailable
  | CartMutationRejected
  | CartLineItemNotFound
  | CartWriteConflict
  | CartWriteOutcomeUnknown
  | CartProviderFailure
  | CartPolicyFailure;

export type RemoveCurrentCartLineItemFailure =
  SetCurrentCartLineItemQuantityFailure;
export type ChangeCurrentCartDiscountCodeFailure = Exclude<
  SetCurrentCartLineItemQuantityFailure,
  CartLineItemNotFound
>;

type ModifyCurrentCart = <E, R>(
  write: (
    target: CartTarget,
    cart: CartSnapshot
  ) => Effect.Effect<CartSnapshot, E, R>
) => Effect.Effect<
  CurrentCartState,
  E | CurrentCartReadFailure | CurrentCartUnavailable,
  R
>;

export class CurrentCart extends Context.Service<
  CurrentCart,
  {
    readonly get: () => Effect.Effect<
      Option.Option<CurrentCartState>,
      CurrentCartReadFailure
    >;
    readonly addItem: (
      input: AddCurrentCartItem
    ) => Effect.Effect<CurrentCartState, AddCurrentCartItemFailure>;
    readonly setLineItemQuantity: (
      input: SetCurrentCartLineItemQuantity
    ) => Effect.Effect<CurrentCartState, SetCurrentCartLineItemQuantityFailure>;
    readonly removeLineItem: (
      input: RemoveCurrentCartLineItem
    ) => Effect.Effect<CurrentCartState, RemoveCurrentCartLineItemFailure>;
    readonly forgetCart: () => Effect.Effect<void>;
    readonly changeDiscountCode: (
      input: ChangeDiscountCode
    ) => Effect.Effect<CurrentCartState, ChangeCurrentCartDiscountCodeFailure>;
    /** Server-side extension point: retains authoritative selection and policy evaluation. */
    readonly modify: ModifyCurrentCart;
  }
>()("@repo/commerce-core/CurrentCart") {
  static readonly get = Effect.fn("CurrentCart.get")(() =>
    CurrentCart.pipe(Effect.flatMap((cart) => cart.get()))
  );
  static readonly addItem = Effect.fn("CurrentCart.addItem")(
    (input: AddCurrentCartItem) =>
      CurrentCart.pipe(Effect.flatMap((cart) => cart.addItem(input)))
  );
  static readonly setLineItemQuantity = Effect.fn(
    "CurrentCart.setLineItemQuantity"
  )((input: SetCurrentCartLineItemQuantity) =>
    CurrentCart.pipe(Effect.flatMap((cart) => cart.setLineItemQuantity(input)))
  );
  static readonly removeLineItem = Effect.fn("CurrentCart.removeLineItem")(
    (input: RemoveCurrentCartLineItem) =>
      CurrentCart.pipe(Effect.flatMap((cart) => cart.removeLineItem(input)))
  );
  static readonly forgetCart = Effect.fn("CurrentCart.forgetCart")(() =>
    CurrentCart.pipe(Effect.flatMap((cart) => cart.forgetCart()))
  );
  static readonly changeDiscountCode = Effect.fn(
    "CurrentCart.changeDiscountCode"
  )((input: ChangeDiscountCode) =>
    CurrentCart.pipe(Effect.flatMap((cart) => cart.changeDiscountCode(input)))
  );

  static readonly layerFromStorage = Layer.effect(
    CurrentCart,
    Effect.gen(function* () {
      const storage = yield* CurrentCartStorage;
      const policies = yield* CartPolicies;
      const { principal, store } = yield* CommerceContext;
      const selected = yield* Ref.make<Option.Option<CartSnapshot> | undefined>(
        undefined
      );
      const resolve = () =>
        Effect.gen(function* () {
          const cached = yield* Ref.get(selected);
          if (cached !== undefined) {
            return cached;
          }
          const cart = yield* storage.resolve();
          yield* Ref.set(selected, cart);
          return cart;
        });
      const targetFor = (cart: CartSnapshot): CartTarget => {
        if (principal._tag === "AnonymousCommercePrincipal") {
          return { _tag: "AnonymousCartTarget", id: cart.id, store };
        }
        if (principal._tag === "B2CPurchasingPrincipal") {
          return {
            _tag: "CustomerCartTarget",
            customerId: principal.customerId,
            id: cart.id,
            store,
          };
        }
        return {
          _tag: "BusinessUnitCartTarget",
          businessUnitId: principal.businessUnitId,
          businessUnitKey: principal.businessUnitKey,
          customerId: principal.customerId,
          id: cart.id,
          store,
        };
      };
      const evaluate = (cart: CartSnapshot) =>
        policies
          .evaluate(cart)
          .pipe(Effect.map((violations) => ({ cart, violations })));
      const replace = (cart: CartSnapshot) =>
        Ref.set(selected, Option.some(cart)).pipe(
          Effect.andThen(evaluate(cart))
        );
      const requireCart = () =>
        resolve().pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => new CurrentCartUnavailable({ reason: "noCart" }),
              onSome: Effect.succeed,
            })
          )
        );

      const modify: ModifyCurrentCart = (write) =>
        Effect.gen(function* () {
          const cart = yield* requireCart();
          const updated = yield* write(targetFor(cart), cart);
          if (updated.id !== cart.id || updated.storeKey !== cart.storeKey) {
            return yield* Effect.die(
              "A cart extension changed the authoritative cart identity"
            );
          }
          return yield* replace(updated);
        });
      return CurrentCart.of({
        addItem: (input) =>
          Effect.gen(function* () {
            const existing = yield* resolve();
            const cart = Option.isSome(existing)
              ? existing.value
              : yield* unavailable(storage.create());
            yield* Ref.set(selected, Option.some(cart));
            return yield* replace(
              yield* unavailable(
                storage.addItem({ ...input, target: targetFor(cart) })
              )
            );
          }),
        changeDiscountCode: (input) =>
          modify((target) =>
            unavailable(storage.changeDiscountCode({ ...input, target }))
          ),
        forgetCart: () =>
          Ref.set(selected, Option.none<CartSnapshot>()).pipe(
            Effect.andThen(storage.forget())
          ),
        get: () =>
          resolve().pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(Option.none<CurrentCartState>()),
                onSome: (cart) => evaluate(cart).pipe(Effect.map(Option.some)),
              })
            )
          ),
        modify,
        removeLineItem: (input) =>
          modify((target) =>
            unavailable(storage.removeLineItem({ ...input, target }))
          ),
        setLineItemQuantity: (input) =>
          modify((target) =>
            unavailable(storage.setLineItemQuantity({ ...input, target }))
          ),
      });
    })
  );

  static readonly layer = (cookie: CurrentCartCookie) =>
    CurrentCart.layerFromStorage.pipe(
      Layer.provide(accountCartStorageLayer(cookie))
    );
}
