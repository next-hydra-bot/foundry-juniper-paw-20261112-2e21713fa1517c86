import {
  LineItemId,
  PositiveCartQuantity,
} from "@repo/commerce-core/domain/cart";
import { Schema } from "effect";

import type { SetCartLineItemQuantityActionResult } from "./action-result";

export const ChangeCartItemsQuantityInputSchema = Schema.Struct({
  lineItemId: LineItemId,
  quantity: PositiveCartQuantity,
});

export type ChangeCartItemsQuantityInput =
  typeof ChangeCartItemsQuantityInputSchema.Encoded;

export type ChangeCartItemsQuantityData = SetCartLineItemQuantityActionResult;

export type ChangeCartItemsQuantityAction = (
  input: ChangeCartItemsQuantityInput
) => Promise<ChangeCartItemsQuantityData>;
