import { Schema } from "effect";

import { CurrencyCode } from "./money";

// Keys are supplied by the owner of the data. Native handles and identifier
// formats are a destination concern, not a restriction on domain identity.
export const CatalogPriceListKey = Schema.NonEmptyString.pipe(
  Schema.brand("CatalogPriceListKey")
);
export type CatalogPriceListKey = typeof CatalogPriceListKey.Type;
export const CatalogPriceListId = Schema.NonEmptyString.pipe(
  Schema.brand("CatalogPriceListId")
);
export type CatalogPriceListId = typeof CatalogPriceListId.Type;
export const CompanyPricingGroupKey = Schema.NonEmptyString.pipe(
  Schema.brand("CompanyPricingGroupKey")
);
export type CompanyPricingGroupKey = typeof CompanyPricingGroupKey.Type;
export const CompanyPricingGroupId = Schema.NonEmptyString.pipe(
  Schema.brand("CompanyPricingGroupId")
);
export type CompanyPricingGroupId = typeof CompanyPricingGroupId.Type;
export const AssortmentKey = Schema.NonEmptyString.pipe(
  Schema.brand("AssortmentKey")
);
export type AssortmentKey = typeof AssortmentKey.Type;
export const AssortmentId = Schema.NonEmptyString.pipe(
  Schema.brand("AssortmentId")
);
export type AssortmentId = typeof AssortmentId.Type;

export const CatalogPriceListInput = Schema.Struct({
  currency: CurrencyCode,
  key: CatalogPriceListKey,
  prices: Schema.NonEmptyArray(
    Schema.Struct({
      centAmount: Schema.Int.check(
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
      ),
      sku: Schema.NonEmptyString,
    })
  ),
});
export type CatalogPriceListInput = typeof CatalogPriceListInput.Type;
export const CatalogPriceList = Schema.Struct({
  ...CatalogPriceListInput.fields,
  id: CatalogPriceListId,
});
export type CatalogPriceList = typeof CatalogPriceList.Type;

export const CompanyPricingGroupInput = Schema.Struct({
  key: CompanyPricingGroupKey,
  priceListKeys: Schema.NonEmptyArray(CatalogPriceListKey).check(
    Schema.isUnique()
  ),
});
export type CompanyPricingGroupInput = typeof CompanyPricingGroupInput.Type;
export const CompanyPricingGroup = Schema.Struct({
  ...CompanyPricingGroupInput.fields,
  id: CompanyPricingGroupId,
});
export type CompanyPricingGroup = typeof CompanyPricingGroup.Type;

export const AssortmentInput = Schema.Struct({
  key: AssortmentKey,
  productKeys: Schema.NonEmptyArray(Schema.NonEmptyString).check(
    Schema.isUnique()
  ),
});
export type AssortmentInput = typeof AssortmentInput.Type;
export const Assortment = Schema.Struct({
  ...AssortmentInput.fields,
  id: AssortmentId,
});
export type Assortment = typeof Assortment.Type;
