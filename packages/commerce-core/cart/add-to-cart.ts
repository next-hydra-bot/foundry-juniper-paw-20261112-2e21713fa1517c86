import {
  PositiveCartQuantity,
  VariantId,
} from "@repo/commerce-core/domain/cart";
import { Schema } from "effect";

import type { AddToCartActionResult } from "./action-result";

export const AddToCartInputSchema = Schema.Struct({
  quantity: PositiveCartQuantity,
  variantId: VariantId,
});

export type AddToCartInput = typeof AddToCartInputSchema.Encoded;

export type AddToCartData = AddToCartActionResult;

export type AddToCartAction = (input: AddToCartInput) => Promise<AddToCartData>;
