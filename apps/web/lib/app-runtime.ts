import {
  findOrderDetail as personalOrderDetail,
  listOrders as personalOrders,
} from "@repo/commerce-b2c/orders/programs";
import "server-only";
import { additionalCommerceServicesLayer } from "@repo/commerce-provider/additional-services";

export const purchasingMode = "b2c" as const;
import { authSessionAdapterLayer } from "@repo/auth/server";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceRequestInput } from "@repo/commerce-core/runtime/commerce-request";
import { makeCommerceBaseApp } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { ShopifyCustomerAccounts } from "@repo/commerce-provider/customer-account/accounts";
import { customerAddressBookLayer } from "@repo/commerce-provider/customer-account/address-book";
import { authenticatedCurrentCartLayer } from "@repo/commerce-provider/customer-account/cart";
import { b2cPurchasingContextLayer } from "@repo/commerce-provider/customer-account/commerce-context";
import { customerProfilesLayer } from "@repo/commerce-provider/customer-account/profiles";
import { orderQueriesLayer } from "@repo/commerce-provider/orders/queries";
import {
  ShopifyStorefrontClient,
  productDiscoveryLayer,
} from "@repo/commerce-provider/provider";
import { sentryEffectTelemetryLayer } from "@repo/observability/effect";
import { Effect, Layer, ManagedRuntime } from "effect";

import { currentAuthLayer } from "./current-auth";
import { nextRequestApiLayer } from "./next-request";
import { nextServerLayer } from "./next-server";

const customerAccounts = ShopifyCustomerAccounts.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(authSessionAdapterLayer, nextRequestApiLayer)
  )
);
const commerce = makeCommerceBaseApp({
  layer: Layer.mergeAll(
    CartPolicies.layer,
    ShopifyStorefrontClient.layer,
    customerAccounts
  ),
  commerceContextLayer: b2cPurchasingContextLayer,
  currentCartLayer: () => authenticatedCurrentCartLayer,
  productDiscoveryLayer,
});
const addressBook = (request: CommerceContextRequest) =>
  customerAddressBookLayer.pipe(
    Layer.provideMerge(commerce.contextLayer(request))
  );
export const CommerceApp = {
  ...commerce,
  requestLayer: (request: CommerceRequestInput) =>
    Layer.merge(commerce.requestLayer(request), addressBook(request.context)),
  provideAddressBook: (request: CommerceContextRequest) =>
    Effect.provide(addressBook(request)),
};
export const appLayer = Layer.mergeAll(
  Layer.orDie(additionalCommerceServicesLayer),
  orderQueriesLayer,
  CommerceApp.layer,
  customerProfilesLayer.pipe(Layer.provide(customerAccounts)),
  authSessionAdapterLayer,
  currentAuthLayer,
  nextServerLayer,
  sentryEffectTelemetryLayer
).pipe();
export const AppRuntime = ManagedRuntime.make(appLayer);

export const orderPrograms = {
  personal: {
    findOrderDetail: personalOrderDetail,
    listOrders: personalOrders,
  },
};
