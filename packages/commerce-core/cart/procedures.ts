import "server-only";
import type { CartActionOperation } from "@repo/commerce-core/cart/action-result";
import {
  AddToCartActionFailure,
  cartContextUnavailable,
  RemoveCartLineItemActionFailure,
  SetCartLineItemQuantityActionFailure,
  ChangeCartDiscountCodeActionFailure,
} from "@repo/commerce-core/cart/action-result";
import { AddToCartInputSchema } from "@repo/commerce-core/cart/add-to-cart";
import { ChangeCartItemsQuantityInputSchema } from "@repo/commerce-core/cart/change-cart-items-quantity";
import {
  CartPublicState,
  toCartPublicState,
} from "@repo/commerce-core/cart/public-state";
import { RemoveCartItemInputSchema } from "@repo/commerce-core/cart/remove-cart-item";
import type {
  CartPolicyFailure,
  CartProviderFailure,
} from "@repo/commerce-core/domain/cart-errors";
/* oxlint-disable promise/prefer-await-to-callbacks -- Action procedure callbacks compose Effects, not Promises. */
import { Effect } from "effect";

import type {
  CommerceActionClient,
  NextCommerceRequestError,
} from "../bindings";
import type {
  AddCurrentCartItemFailure,
  RemoveCurrentCartLineItemFailure,
  SetCurrentCartLineItemQuantityFailure,
  ChangeCurrentCartDiscountCodeFailure,
} from "../services/current-cart";
import { CurrentCart } from "../services/current-cart";
import { ChangeCartDiscountCodeInputSchema } from "./change-cart-discount-code";
import { retainExpectedCartMutationFailures } from "./failure-policy";

type AddToCartExpectedFailure = Exclude<
  AddCurrentCartItemFailure,
  | CartPolicyFailure
  | CartProviderFailure
  | { readonly _tag: "CurrentCartOperationFailure" }
>;
type SetCartLineItemQuantityExpectedFailure = Exclude<
  SetCurrentCartLineItemQuantityFailure,
  CartPolicyFailure | CartProviderFailure
>;
type RemoveCartLineItemExpectedFailure = Exclude<
  RemoveCurrentCartLineItemFailure,
  CartPolicyFailure | CartProviderFailure
>;
type ChangeDiscountCodeExpectedFailure = Exclude<
  ChangeCurrentCartDiscountCodeFailure,
  CartPolicyFailure | CartProviderFailure
>;
type ExpectedCartMutationFailure =
  | AddToCartExpectedFailure
  | SetCartLineItemQuantityExpectedFailure;

function cartMutationFailure(
  operation: "addItem",
  error:
    | AddToCartExpectedFailure
    | CartProviderFailure
    | NextCommerceRequestError
): AddToCartActionFailure;
function cartMutationFailure(
  operation: "setLineItemQuantity",
  error:
    | SetCartLineItemQuantityExpectedFailure
    | CartProviderFailure
    | NextCommerceRequestError
): SetCartLineItemQuantityActionFailure;
function cartMutationFailure(
  operation: "removeLineItem",
  error:
    | RemoveCartLineItemExpectedFailure
    | CartProviderFailure
    | NextCommerceRequestError
): RemoveCartLineItemActionFailure;
function cartMutationFailure(
  operation: "changeDiscountCode",
  error:
    | ChangeDiscountCodeExpectedFailure
    | CartProviderFailure
    | NextCommerceRequestError
): ChangeCartDiscountCodeActionFailure;
function cartMutationFailure(
  operation: CartActionOperation,
  error:
    | ExpectedCartMutationFailure
    | CartProviderFailure
    | NextCommerceRequestError
): AddToCartActionFailure | SetCartLineItemQuantityActionFailure {
  if (error._tag === "CommerceAccountUnavailable") {
    return {
      _tag: "CartProviderFailure",
      operation,
      reason: "unavailable",
    };
  }
  if (error._tag === "CommerceRequestContextNotFound") {
    return cartContextUnavailable({
      message: "The cart is unavailable for the current account.",
      reason: error.reason,
    });
  }
  if (error._tag === "CartProviderFailure") {
    if (error.reason !== "unavailable") {
      throw error;
    }

    return {
      _tag: "CartProviderFailure",
      operation: error.operation,
      reason: "unavailable",
    };
  }
  return error;
}

const addToCartProgram = Effect.fn("CartAction.addToCart")(
  (input: typeof AddToCartInputSchema.Type) =>
    CurrentCart.addItem(input).pipe(
      retainExpectedCartMutationFailures("addItem"),
      Effect.map(toCartPublicState)
    )
);

const changeCartItemsQuantityProgram = Effect.fn(
  "CartAction.changeCartItemsQuantity"
)((input: typeof ChangeCartItemsQuantityInputSchema.Type) =>
  CurrentCart.setLineItemQuantity(input).pipe(
    retainExpectedCartMutationFailures("setLineItemQuantity"),
    Effect.map(toCartPublicState)
  )
);

const removeCartItemProgram = Effect.fn("CartAction.removeCartItem")(
  (input: typeof RemoveCartItemInputSchema.Type) =>
    CurrentCart.removeLineItem(input).pipe(
      retainExpectedCartMutationFailures("removeLineItem"),
      Effect.map(toCartPublicState)
    )
);

export const makeCartProcedures = <RuntimeServices, Context extends object>(
  actions: CommerceActionClient<CurrentCart, RuntimeServices, Context>
) => ({
  addToCartProcedure: actions
    .procedure("CartAction.addToCart")
    .input(AddToCartInputSchema)
    .output(CartPublicState)
    .error(AddToCartActionFailure)
    .mapError(
      (
        error:
          | AddToCartExpectedFailure
          | CartProviderFailure
          | NextCommerceRequestError
      ) => cartMutationFailure("addItem", error)
    )
    .handle(addToCartProgram),
  changeCartDiscountCodeProcedure: actions
    .procedure("CartAction.changeDiscountCode")
    .input(ChangeCartDiscountCodeInputSchema)
    .output(CartPublicState)
    .error(ChangeCartDiscountCodeActionFailure)
    .mapError(
      (
        error:
          | ChangeDiscountCodeExpectedFailure
          | CartProviderFailure
          | NextCommerceRequestError
      ) => cartMutationFailure("changeDiscountCode", error)
    )
    .handle((input) =>
      CurrentCart.changeDiscountCode(input).pipe(
        retainExpectedCartMutationFailures("changeDiscountCode"),
        Effect.map(toCartPublicState)
      )
    ),
  changeCartItemsQuantityProcedure: actions
    .procedure("CartAction.changeCartItemsQuantity")
    .input(ChangeCartItemsQuantityInputSchema)
    .output(CartPublicState)
    .error(SetCartLineItemQuantityActionFailure)
    .mapError(
      (
        error:
          | Exclude<SetCurrentCartLineItemQuantityFailure, CartPolicyFailure>
          | NextCommerceRequestError
      ) => cartMutationFailure("setLineItemQuantity", error)
    )
    .handle(changeCartItemsQuantityProgram),
  removeCartItemProcedure: actions
    .procedure("CartAction.removeCartItem")
    .input(RemoveCartItemInputSchema)
    .output(CartPublicState)
    .error(RemoveCartLineItemActionFailure)
    .mapError(
      (
        error:
          | Exclude<RemoveCurrentCartLineItemFailure, CartPolicyFailure>
          | NextCommerceRequestError
      ) => cartMutationFailure("removeLineItem", error)
    )
    .handle(removeCartItemProgram),
});
