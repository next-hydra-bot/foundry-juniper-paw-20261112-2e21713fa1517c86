import { Schema } from "effect";

import { CommerceLocale, StoreKey } from "../store";
import { CompanyPricingGroupKey } from "./pricing";

export const CompanyPurchasingPolicyKey = Schema.NonEmptyString.pipe(
  Schema.brand("CompanyPurchasingPolicyKey")
);
export type CompanyPurchasingPolicyKey = typeof CompanyPurchasingPolicyKey.Type;

/** Company purchasing assigns pricing in a Store; its public assortment belongs to the market. */
export const CompanyPurchasingPolicy = Schema.Struct({
  currency: Schema.NonEmptyString,
  key: CompanyPurchasingPolicyKey,
  label: Schema.NonEmptyString,
  locale: CommerceLocale,
  pricingGroupKey: Schema.toEncoded(CompanyPricingGroupKey),
  storeKey: StoreKey,
});
export type CompanyPurchasingPolicy = typeof CompanyPurchasingPolicy.Type;

/** Labels may change; approved buying terms may not silently change on retry. */
export const sameCompanyPurchasingPolicy = (
  left: CompanyPurchasingPolicy | undefined,
  right: CompanyPurchasingPolicy | undefined
) =>
  left === undefined || right === undefined
    ? left === right
    : left.key === right.key &&
      left.storeKey === right.storeKey &&
      left.locale === right.locale &&
      left.currency === right.currency &&
      left.pricingGroupKey === right.pricingGroupKey;
