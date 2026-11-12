import { Schema } from "effect";

import { Money } from "./money";

export const DiscountCode = Schema.Trimmed.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255)
);

export const CartDiscountCode = Schema.Struct({
  applicable: Schema.Boolean,
  code: DiscountCode,
});
export type CartDiscountCode = typeof CartDiscountCode.Type;

/** Observed provider allocations; eligibility and stacking stay with the provider. */
export const CartDiscount = Schema.Struct({
  amount: Money,
  label: Schema.optional(Schema.String),
  reference: Schema.optional(Schema.NonEmptyString),
  target: Schema.Literals(["items", "shipping", "total"]),
});
export type CartDiscount = typeof CartDiscount.Type;

export const ChangeDiscountCode = Schema.Struct({
  action: Schema.Literals(["add", "remove"]),
  code: DiscountCode,
});
export type ChangeDiscountCode = typeof ChangeDiscountCode.Type;
