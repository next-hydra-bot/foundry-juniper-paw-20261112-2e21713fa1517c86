import { Money } from "@repo/commerce-core/domain/money";
import type { Store } from "@repo/commerce-core/store";
import { Schema } from "effect";

export const ShopifyMoney = Schema.Struct({
  amount: Schema.String,
  currencyCode: Schema.String,
});
export type ShopifyMoney = typeof ShopifyMoney.Type;
export const ShopifyImage = Schema.Struct({
  altText: Schema.NullOr(Schema.String),
  url: Schema.String,
});
export const PageInfo = Schema.Struct({
  endCursor: Schema.NullOr(Schema.String),
  hasNextPage: Schema.Boolean,
});

/** Convert decimal strings exactly at the currency's minor-unit precision. */
export const mapMoney = (money: ShopifyMoney, store: Store) => {
  if (money.currencyCode !== store.currency) {
    throw new Error("Shopify returned a currency outside the selected Store");
  }
  const precision =
    new Intl.NumberFormat("en", {
      currency: money.currencyCode,
      style: "currency",
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const match = /^(?<units>\d+)(?:\.(?<decimals>\d+))?$/u.exec(money.amount);
  if (!match) {
    throw new Error("Invalid Shopify monetary amount");
  }
  const decimals = match.groups?.decimals ?? "";
  if (/[^0]/u.test(decimals.slice(precision))) {
    throw new Error("Shopify amount exceeds the currency precision");
  }
  const amount =
    BigInt(match.groups?.units ?? "0") * 10n ** BigInt(precision) +
    BigInt(decimals.slice(0, precision).padEnd(precision, "0") || "0");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Shopify amount exceeds the supported monetary range");
  }
  return Schema.decodeUnknownSync(Money)({
    centAmount: Number(amount),
    currencyCode: money.currencyCode,
  });
};
