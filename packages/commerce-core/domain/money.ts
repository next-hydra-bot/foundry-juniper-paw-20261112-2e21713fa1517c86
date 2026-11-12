import { Schema } from "effect";

export const CurrencyCode = Schema.String.check(
  Schema.isPattern(/^[A-Z]{3}$/u)
);
export type CurrencyCode = typeof CurrencyCode.Type;

export const Money = Schema.Struct({
  centAmount: Schema.Int,
  currencyCode: CurrencyCode,
});
export type Money = typeof Money.Type;

export const moneyToUnits = (money: Money): number =>
  money.centAmount /
  10 **
    (new Intl.NumberFormat("en", {
      currency: money.currencyCode,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2);
