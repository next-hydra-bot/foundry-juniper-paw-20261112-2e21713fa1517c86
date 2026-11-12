import type { NextRequestApi } from "@repo/actions/next-request";
import { unconfiguredNextCommerceBinding } from "@repo/commerce-core/runtime/bindings";
import type { CommerceBaseRequestServices } from "@repo/commerce-core/runtime/make-commerce-base-app";
import type { CartPolicies } from "@repo/commerce-core/services/cart-policies";

import type { ShopifyStorefrontClient } from "../client/storefront";

/** The recipe aliases this port to the application's concrete runtime. */
export const { CommerceActions, NextCommerce } =
  unconfiguredNextCommerceBinding<
    CommerceBaseRequestServices,
    CartPolicies | ShopifyStorefrontClient | NextRequestApi
  >();
