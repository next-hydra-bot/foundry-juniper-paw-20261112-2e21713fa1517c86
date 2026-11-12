import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { Effect, Schema } from "effect";

import { cartStorageLayer } from "../cart";
import { ShopifyCartSession } from "../cart/session";

export class ShopifyCheckoutUnavailable extends Schema.TaggedError<ShopifyCheckoutUnavailable>()(
  "ShopifyCheckoutUnavailable",
  {
    reason: Schema.Literals(["emptyCart", "cartPolicy"]),
  }
) {}

export const checkoutDestination = Effect.gen(function* () {
  const checkout = yield* ShopifyCartSession.pipe(
    Effect.flatMap((session) => session.readCheckout()),
    Effect.catchTag(
      "CurrentCartUnavailable",
      () => new ShopifyCheckoutUnavailable({ reason: "emptyCart" })
    )
  );
  if (checkout.cart.lineItems.length === 0) {
    return yield* new ShopifyCheckoutUnavailable({ reason: "emptyCart" });
  }
  const policies = yield* CartPolicies;
  const violations = yield* policies.evaluate(checkout.cart);
  if (violations.length > 0) {
    return yield* new ShopifyCheckoutUnavailable({ reason: "cartPolicy" });
  }
  return checkout.checkoutUrl;
});

export const startCheckout = Effect.fn("ShopifyCheckout.start")(() =>
  checkoutDestination.pipe(Effect.provide(cartStorageLayer))
);
