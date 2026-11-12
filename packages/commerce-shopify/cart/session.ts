import type {
  CartProviderFailure,
  CurrentCartUnavailable,
} from "@repo/commerce-core/domain/cart-errors";
import type { CartSnapshot } from "@repo/commerce-core/domain/cart-snapshot";
import { Context } from "effect";
import type { Effect } from "effect";

export const CART_COOKIE_NAME = "shopify-cart";
export class ShopifyCartSession extends Context.Service<
  ShopifyCartSession,
  {
    readonly buyerSynchronizationPending: Effect.Effect<boolean>;
    readonly synchronizeBuyer: () => Effect.Effect<void, CartProviderFailure>;
    readonly detachBuyer: () => Effect.Effect<void, CartProviderFailure>;
    readonly readCheckout: () => Effect.Effect<
      {
        readonly cart: CartSnapshot;
        readonly checkoutUrl: `https://${string}`;
      },
      CartProviderFailure | CurrentCartUnavailable
    >;
  }
>()("@repo/commerce-shopify/CartSession") {}
