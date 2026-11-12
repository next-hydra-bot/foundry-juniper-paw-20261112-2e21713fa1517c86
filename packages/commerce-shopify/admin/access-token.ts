import "server-only";
import type { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { Context, Effect, Layer } from "effect";
import type { Redacted } from "effect";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This provider Layer owns construction of its shared token implementation.
import { makeShopifyAdminAccessToken } from "./access-token-core";
import { adminKeys } from "./keys";
import type { ShopifyAdminEnvironment } from "./keys";

/** One app installation's server credentials; the cache contains no shopper state. */
export class ShopifyAdminAccessToken extends Context.Service<
  ShopifyAdminAccessToken,
  {
    readonly get: Effect.Effect<Redacted.Redacted, CommerceAccountUnavailable>;
    readonly invalidate: (rejected: Redacted.Redacted) => Effect.Effect<void>;
  }
>()("@repo/commerce-shopify/AdminAccessToken") {
  static readonly layerWith = (
    environment: ShopifyAdminEnvironment,
    fetchApi: typeof fetch = globalThis.fetch
  ) =>
    Layer.effect(
      ShopifyAdminAccessToken,
      makeShopifyAdminAccessToken(environment, fetchApi).pipe(Effect.orDie)
    );

  static readonly layer = Layer.suspend(() =>
    ShopifyAdminAccessToken.layerWith(adminKeys())
  );
}
