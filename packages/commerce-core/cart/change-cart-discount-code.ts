import type { ChangeDiscountCode } from "../domain/promotions";
import type { ChangeCartDiscountCodeActionResult } from "./action-result";

export { ChangeDiscountCode as ChangeCartDiscountCodeInputSchema } from "../domain/promotions";
export type ChangeCartDiscountCodeInput = typeof ChangeDiscountCode.Encoded;
export type ChangeCartDiscountCodeAction = (
  input: ChangeCartDiscountCodeInput
) => Promise<ChangeCartDiscountCodeActionResult>;
