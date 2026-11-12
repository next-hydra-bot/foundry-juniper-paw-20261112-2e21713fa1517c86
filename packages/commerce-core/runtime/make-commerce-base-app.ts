import { Effect, Layer } from "effect";

import type {
  CommerceContextRequest,
  CommerceRequestContextNotFound,
} from "../domain/commerce-request-context";
import type { ProductDiscovery } from "../product/product-discovery";
import type { CartPolicies } from "../services/cart-policies";
import type { Carts } from "../services/carts";
import type {
  CommerceAccountUnavailable,
  CommerceAccounts,
} from "../services/commerce-accounts";
import type { CommerceBuyerAccounts } from "../services/commerce-buyer-accounts";
import type { CommerceContext } from "../services/commerce-context";
import type { CurrentCart } from "../services/current-cart";
import type { CommerceRequestInput } from "./commerce-request";

export type CommerceBaseRequestServices =
  | CommerceContext
  | CurrentCart
  | ProductDiscovery;
/** Existing account-backed assembly's stable capabilities. Hosts can supply a smaller set. */
export type CommerceBaseStableServices =
  | CartPolicies
  | Carts
  | CommerceAccounts
  | CommerceBuyerAccounts;
export type CommerceRequestProvisionError =
  | CommerceAccountUnavailable
  | CommerceRequestContextNotFound;
export type CommerceContextLayer = (
  request: CommerceContextRequest
) => Layer.Layer<
  CommerceContext,
  CommerceRequestProvisionError,
  CommerceAccounts
>;

export interface CommerceBaseApplication<
  LayerError,
  ProvisionError,
  StableServices = CommerceBaseStableServices,
> {
  readonly layer: Layer.Layer<StableServices, LayerError>;
  readonly contextLayer: (
    request: CommerceContextRequest
  ) => Layer.Layer<
    CommerceContext,
    CommerceRequestProvisionError,
    StableServices
  >;
  readonly requestLayer: (
    request: CommerceRequestInput
  ) => Layer.Layer<CommerceBaseRequestServices, ProvisionError, StableServices>;
  readonly provide: (
    request: CommerceRequestInput
  ) => <A, E>(
    program: Effect.Effect<A, E, CommerceBaseRequestServices | StableServices>
  ) => Effect.Effect<A, E | ProvisionError, StableServices>;
}

/** The host selects stable capabilities, buying context and provider-owned cart persistence. */
export const makeCommerceBaseApp = <
  StableServices,
  LayerError,
  ContextError extends CommerceRequestProvisionError,
  CartError,
  DiscoveryError,
>(bindings: {
  readonly layer: Layer.Layer<StableServices, LayerError>;
  readonly commerceContextLayer: (
    request: CommerceContextRequest
  ) => Layer.Layer<CommerceContext, ContextError, StableServices>;
  readonly currentCartLayer: (
    request: CommerceRequestInput
  ) => Layer.Layer<CurrentCart, CartError, CommerceContext | StableServices>;
  readonly productDiscoveryLayer: Layer.Layer<
    ProductDiscovery,
    DiscoveryError,
    CommerceContext | StableServices
  >;
}): CommerceBaseApplication<
  LayerError,
  ContextError | CartError | DiscoveryError,
  StableServices
> => {
  const requestLayer = (request: CommerceRequestInput) => {
    const context = bindings.commerceContextLayer(request.context);
    return Layer.mergeAll(
      context,
      bindings.currentCartLayer(request).pipe(Layer.provideMerge(context)),
      bindings.productDiscoveryLayer.pipe(Layer.provideMerge(context))
    );
  };
  return {
    contextLayer: bindings.commerceContextLayer,
    layer: bindings.layer,
    provide: (request) => Effect.provide(requestLayer(request)),
    requestLayer,
  };
};
