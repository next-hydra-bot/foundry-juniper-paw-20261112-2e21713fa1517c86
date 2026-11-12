"use server";

import { CommerceActions } from "@repo/commerce-core/bindings";
import { refresh } from "next/cache";

import type { AddToCartInput } from "./add-to-cart";
import type { ChangeCartDiscountCodeInput } from "./change-cart-discount-code";
import type { ChangeCartItemsQuantityInput } from "./change-cart-items-quantity";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This constructs Action procedures over the application-selected binding, not a provider service.
import { makeCartProcedures } from "./procedures";
import type { RemoveCartItemInput } from "./remove-cart-item";

const procedures = makeCartProcedures(CommerceActions);
const add = procedures.addToCartProcedure.toAction();
const change = procedures.changeCartItemsQuantityProcedure.toAction();
const remove = procedures.removeCartItemProcedure.toAction();
const discountCode = procedures.changeCartDiscountCodeProcedure.toAction();

export const addToCart = async (input: AddToCartInput) => await add(input);
export const changeCartItemsQuantity = async (
  input: ChangeCartItemsQuantityInput
) => await change(input);
export const removeCartItem = async (input: RemoveCartItemInput) =>
  await remove(input);
export const changeCartDiscountCode = async (
  input: ChangeCartDiscountCodeInput
) => {
  const result = await discountCode(input);
  if (result._tag === "Success") {
    refresh();
  }
  return result;
};
