import type { CartPolicyFailure } from "@repo/commerce-core/domain/cart-errors";
import type {
  CartPolicyViolation,
  CartSnapshot,
} from "@repo/commerce-core/domain/cart-snapshot";
import { Context, Effect, Layer } from "effect";

export interface CartPolicy {
  readonly name: string;
  readonly evaluate: (
    cart: CartSnapshot
  ) => Effect.Effect<readonly CartPolicyViolation[], CartPolicyFailure>;
}

const maximumGuestItems = 50;

export const guestMaximumItemsPolicy: CartPolicy = {
  evaluate: Effect.fn("CartPolicies.guestMaximumItems")((cart) => {
    if (
      cart.buyingContext !== undefined ||
      cart.customerId !== undefined ||
      cart.totalLineItemQuantity <= maximumGuestItems
    ) {
      return Effect.succeed([]);
    }

    let runningTotal = 0;
    const violations: CartPolicyViolation[] = [];
    for (const lineItem of cart.lineItems) {
      const previousTotal = runningTotal;
      runningTotal += lineItem.quantity;
      if (runningTotal <= maximumGuestItems) {
        continue;
      }
      const excessQuantity =
        runningTotal -
        maximumGuestItems -
        Math.max(previousTotal - maximumGuestItems, 0);
      if (excessQuantity <= 0) {
        continue;
      }
      const target: CartPolicyViolation["targets"][number] = {
        lineItemId: lineItem.id,
        productId: lineItem.variant.productId,
        type: "cartItem",
        variantId: lineItem.variant.id,
      };
      const { sku } = lineItem.variant;
      violations.push({
        code: "MAX_GUEST_TOTAL_ITEMS_EXCEEDED",
        parameters: {
          excessQuantity,
          maxQuantity: maximumGuestItems,
          totalQuantity: cart.totalLineItemQuantity,
        },
        targets: [sku === undefined ? target : { ...target, sku }],
      });
    }
    return Effect.succeed(violations);
  }),
  name: "guest-max-limits",
};

export class CartPolicies extends Context.Service<
  CartPolicies,
  {
    readonly evaluate: (
      cart: CartSnapshot
    ) => Effect.Effect<readonly CartPolicyViolation[], CartPolicyFailure>;
  }
>()("@repo/commerce-core/CartPolicies") {
  static readonly layerFrom = (policies: readonly CartPolicy[]) =>
    Layer.succeed(
      CartPolicies,
      CartPolicies.of({
        evaluate: Effect.fn("CartPolicies.evaluate")((cart) =>
          Effect.forEach(policies, (policy) => policy.evaluate(cart), {
            concurrency: "unbounded",
          }).pipe(Effect.map((violations) => violations.flat()))
        ),
      })
    );

  static readonly layerEmpty = CartPolicies.layerFrom([]);

  static readonly layer = CartPolicies.layerFrom([guestMaximumItemsPolicy]);
}
