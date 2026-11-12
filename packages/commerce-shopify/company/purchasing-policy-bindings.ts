import { CompanyPurchasingPolicy } from "@repo/commerce-core/domain/company-purchasing-policy";
import { Schema } from "effect";

export const ShopifyPurchasingPolicyBindings = Schema.Array(
  Schema.Struct({
    ...CompanyPurchasingPolicy.fields,
    pricingCatalogId: Schema.NonEmptyString,
    pricingMarketId: Schema.NonEmptyString,
  })
);
export type ShopifyPurchasingPolicyBindings =
  typeof ShopifyPurchasingPolicyBindings.Type;
