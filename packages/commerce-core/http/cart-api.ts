import { InputInvalid, definePublicError } from "@repo/errors";
import { Effect, Option, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { AddToCartInputSchema } from "../cart/add-to-cart";
import { ChangeCartDiscountCodeInputSchema } from "../cart/change-cart-discount-code";
import { ChangeCartItemsQuantityInputSchema } from "../cart/change-cart-items-quantity";
import { retainExpectedCartMutationFailures } from "../cart/failure-policy";
import { CartPublicState, toCartPublicState } from "../cart/public-state";
import { RemoveCartItemInputSchema } from "../cart/remove-cart-item";
import {
  CartLineItemNotFound,
  CartMerchandiseUnavailable,
  CartMutationRejected,
  CartWriteConflict,
  CartWriteOutcomeUnknown,
  CurrentCartSelectionConflict,
  CurrentCartUnavailable,
} from "../domain/cart-errors";
import { CurrentCart } from "../services/current-cart";
import type { CurrentCartReadFailure } from "../services/current-cart";
import { CommerceRequestHeaders } from "./commerce-request";

const unavailable = definePublicError({
  category: "unavailable",
  code: "cart.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "CartProviderFailure",
});
export const CartApiUnavailable = unavailable.schema;

const readFailure = (
  error: CurrentCartReadFailure
): Effect.Effect<
  never,
  CurrentCartSelectionConflict | typeof CartApiUnavailable.Type
> => {
  if (error._tag === "CurrentCartSelectionConflict") {
    return Effect.fail(error);
  }
  return error._tag === "CartProviderFailure" && error.reason === "unavailable"
    ? Effect.fail(
        unavailable.make({ message: "The cart is temporarily unavailable." })
      )
    : Effect.die(error);
};

export const cartHttpPrograms = {
  addItem: (input: typeof AddToCartInputSchema.Type) =>
    CurrentCart.addItem(input).pipe(
      retainExpectedCartMutationFailures("addItem"),
      Effect.catchTag("CartProviderFailure", () =>
        Effect.fail(
          unavailable.make({ message: "The cart is temporarily unavailable." })
        )
      ),
      Effect.map(toCartPublicState)
    ),
  changeDiscountCode: (input: typeof ChangeCartDiscountCodeInputSchema.Type) =>
    CurrentCart.changeDiscountCode(input).pipe(
      retainExpectedCartMutationFailures("changeDiscountCode"),
      Effect.catchTag("CartProviderFailure", () =>
        Effect.fail(
          unavailable.make({ message: "The cart is temporarily unavailable." })
        )
      ),
      Effect.map(toCartPublicState)
    ),
  current: CurrentCart.get().pipe(
    Effect.catch(readFailure),
    Effect.map(Option.match({ onNone: () => null, onSome: toCartPublicState }))
  ),
  removeItem: (input: typeof RemoveCartItemInputSchema.Type) =>
    CurrentCart.removeLineItem(input).pipe(
      retainExpectedCartMutationFailures("removeLineItem"),
      Effect.catchTag("CartProviderFailure", () =>
        Effect.fail(
          unavailable.make({ message: "The cart is temporarily unavailable." })
        )
      ),
      Effect.map(toCartPublicState)
    ),
  setQuantity: (input: typeof ChangeCartItemsQuantityInputSchema.Type) =>
    CurrentCart.setLineItemQuantity(input).pipe(
      retainExpectedCartMutationFailures("setLineItemQuantity"),
      Effect.catchTag("CartProviderFailure", () =>
        Effect.fail(
          unavailable.make({ message: "The cart is temporarily unavailable." })
        )
      ),
      Effect.map(toCartPublicState)
    ),
};

const readErrors = [
  CartApiUnavailable,
  CurrentCartSelectionConflict.annotate({ httpApiStatus: 409 }),
];
const mutationErrors = [
  ...readErrors,
  InputInvalid,
  CurrentCartUnavailable.annotate({ httpApiStatus: 404 }),
  CartMutationRejected.annotate({ httpApiStatus: 422 }),
  CartWriteConflict.annotate({ httpApiStatus: 409 }),
  CartWriteOutcomeUnknown.annotate({ httpApiStatus: 409 }),
];

/** Hosts apply their authentication/request middleware before exposing this group. */
export const makeCartApiGroup = <Headers extends Schema.Top>(
  headers: Headers
) =>
  HttpApiGroup.make("cart")
    .add(
      HttpApiEndpoint.get("current", "/cart", {
        error: readErrors,
        headers,
        success: Schema.NullOr(CartPublicState),
      })
    )
    .add(
      HttpApiEndpoint.post("addItem", "/cart/items", {
        error: [
          ...mutationErrors,
          CartMerchandiseUnavailable.annotate({ httpApiStatus: 422 }),
        ],
        headers,
        payload: AddToCartInputSchema,
        success: CartPublicState,
      })
    )
    .add(
      HttpApiEndpoint.patch("setQuantity", "/cart/items", {
        error: [
          ...mutationErrors,
          CartLineItemNotFound.annotate({ httpApiStatus: 404 }),
        ],
        headers,
        payload: ChangeCartItemsQuantityInputSchema,
        success: CartPublicState,
      })
    )
    .add(
      HttpApiEndpoint.delete("removeItem", "/cart/items", {
        error: [
          ...mutationErrors,
          CartLineItemNotFound.annotate({ httpApiStatus: 404 }),
        ],
        headers,
        payload: RemoveCartItemInputSchema,
        success: CartPublicState,
      })
    )
    .add(
      HttpApiEndpoint.patch("changeDiscountCode", "/cart/discount-codes", {
        error: mutationErrors,
        headers,
        payload: ChangeCartDiscountCodeInputSchema,
        success: CartPublicState,
      })
    );

export class CartApiGroup extends makeCartApiGroup(CommerceRequestHeaders) {}
