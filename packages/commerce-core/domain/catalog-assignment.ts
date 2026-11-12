import { Schema } from "effect";

import { CommerceLocale, StoreKey } from "../store";
import { CompanyPricingGroupKey } from "./pricing";

export const CatalogAssignmentKey = Schema.NonEmptyString.pipe(
  Schema.brand("CatalogAssignmentKey")
);
export type CatalogAssignmentKey = typeof CatalogAssignmentKey.Type;
export const CatalogAssignmentInput = Schema.Struct({
  key: CatalogAssignmentKey,
  locale: CommerceLocale,
  pricingGroupKey: CompanyPricingGroupKey,
  storeKey: StoreKey,
});
export type CatalogAssignmentInput = typeof CatalogAssignmentInput.Type;
