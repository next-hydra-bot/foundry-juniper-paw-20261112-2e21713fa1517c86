import { CatalogAssignmentInput } from "../domain/catalog-assignment";
import { CustomerInput } from "../domain/customer";
import { CustomerIdentityLinkInput } from "../domain/customer-identity-link";
import {
  AssortmentInput,
  CatalogPriceListInput,
  CompanyPricingGroupInput,
} from "../domain/pricing";

/** Models are shared with runtime domain code; source files remain independent. */
export const commerceInputModels = {
  assortments: AssortmentInput,
  "catalog-assignments": CatalogAssignmentInput,
  "customer-identity-links": CustomerIdentityLinkInput,
  customers: CustomerInput,
  "price-lists": CatalogPriceListInput,
  "pricing-groups": CompanyPricingGroupInput,
} as const;
