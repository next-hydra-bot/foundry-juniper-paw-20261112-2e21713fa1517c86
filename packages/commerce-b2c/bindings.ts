import type { NextRequestApi } from "@repo/actions/next-request";
import type { AuthSessionAdapter } from "@repo/auth-contract/session";
import { unconfiguredNextCommerceBinding } from "@repo/commerce-core/runtime/bindings";
import type { CommerceBaseStableServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { AddressBook } from "@repo/commerce-core/services/address-book";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { CustomerProfiles } from "@repo/commerce-core/services/customer-profiles";
import type { OrderQueries } from "@repo/commerce-core/services/order-queries";

/** The customer registration recipe binds this module to the application's runtime. */
export const { Actions, NextCommerce } = unconfiguredNextCommerceBinding<
  AddressBook | CommerceContext,
  | OrderQueries
  | CommerceBaseStableServices
  | AuthSessionAdapter
  | CustomerProfiles
  | NextRequestApi
>();
