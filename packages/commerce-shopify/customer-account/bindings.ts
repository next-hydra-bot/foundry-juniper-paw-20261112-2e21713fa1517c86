import type { NextRequestApi } from "@repo/actions/next-request";
import { unconfiguredNextCommerceBinding } from "@repo/commerce-core/runtime/bindings";
import type { CommerceBaseRequestServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import type { CommerceBuyerAccounts } from "@repo/commerce-core/services/commerce-buyer-accounts";
import type { OrderQueries } from "@repo/commerce-core/services/order-queries";

import type { ShopifyStorefrontClient } from "../client/storefront";
import type { ShopifyCustomerAccounts } from "./accounts";

export const { NextCommerce } = unconfiguredNextCommerceBinding<
  CommerceBaseRequestServices,
  | ShopifyCustomerAccounts
  | CartPolicies
  | ShopifyStorefrontClient
  | NextRequestApi
  | CommerceBuyerAccounts
  | OrderQueries
>();
