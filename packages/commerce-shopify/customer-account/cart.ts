import { createHash } from "node:crypto";

import { CartProviderFailure } from "@repo/commerce-core/domain/cart-errors";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { Effect, Layer, Redacted } from "effect";

import { cartStorageLayerWith } from "../cart";
import { ShopifyCustomerAccounts } from "./accounts";

export const authenticatedCartBuyer = Effect.gen(function* () {
  const { principal } = yield* CommerceContext;
  const accounts = yield* ShopifyCustomerAccounts;
  const identity = yield* accounts.read.pipe(Effect.orDie);
  if (principal._tag === "AnonymousCommercePrincipal") {
    return { accessToken: Effect.succeed(undefined) };
  }
  if (
    !identity ||
    identity.customer.id !== principal.customerId ||
    identity.authUserId !== principal.authUserId
  ) {
    return yield* Effect.die(
      "Shopify customer session does not match the purchasing context"
    );
  }
  return {
    accessToken: accounts.cartAccessToken.pipe(
      Effect.map(Redacted.value),
      Effect.mapError(
        () =>
          new CartProviderFailure({
            operation: "findById",
            reason: "unavailable",
          })
      )
    ),
    companyLocationId:
      principal._tag === "CustomerCommercePrincipal"
        ? principal.businessUnitId
        : undefined,
    completeSynchronization: accounts.completeCartSynchronization.pipe(
      Effect.mapError(
        () =>
          new CartProviderFailure({
            operation: "findById",
            reason: "unavailable",
          })
      )
    ),
    customerId: identity.customer.id,
    scope: identity.scope,
    synchronizationPending: identity.cartSynchronizationPending,
    tokenFingerprint:
      principal._tag === "CustomerCommercePrincipal" && identity.accessToken
        ? createHash("sha256")
            .update(Redacted.value(identity.accessToken))
            .digest("hex")
        : undefined,
  };
});

export const authenticatedCartStorageLayer = cartStorageLayerWith(
  authenticatedCartBuyer
);

export const authenticatedCurrentCartLayer = CurrentCart.layerFromStorage.pipe(
  Layer.provide(authenticatedCartStorageLayer)
);
