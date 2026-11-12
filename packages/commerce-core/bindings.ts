import { unconfiguredNextCommerceBinding } from "./runtime/bindings";
import type {
  CommerceBaseRequestServices,
  CommerceBaseStableServices,
} from "./runtime/make-commerce-base-app";

export {
  CommerceRuntimeNotConfigured,
  type CommerceActionClient,
  type CommerceRequestOptions,
  type NextCommerceRequestError,
} from "./runtime/bindings";

/** Replaced by the application's exact alias when the storefront is composed. */
export const { CommerceActions, NextCommerce } =
  unconfiguredNextCommerceBinding<
    CommerceBaseRequestServices,
    CommerceBaseStableServices
  >();
