import { NextRequestApi } from "@repo/actions/next-request";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { Effect, Layer, Option, Schema } from "effect";

import { ShopifyCartPersistence } from "./persistence";
import { CartCookieJson } from "./schema";
import { cartStorageLayerWith as storageLayerWith } from "./storage";
import type { ShopifyCartBuyer } from "./storage";

export type { ShopifyCartBuyer } from "./storage";

const nextCartPersistenceLayer = Layer.effect(
  ShopifyCartPersistence,
  Effect.gen(function* () {
    const next = yield* NextRequestApi;
    const cookies = yield* next.getCookies();
    return ShopifyCartPersistence.of({
      clear: (key) =>
        Effect.sync(() => {
          cookies.delete(key);
        }),
      read: (key) =>
        Effect.sync(() => {
          const value = cookies.get(key)?.value;
          return value === undefined
            ? Option.none()
            : Schema.decodeOption(CartCookieJson)(value);
        }),
      write: (key, cart) =>
        Effect.sync(() => {
          cookies.set(key, Schema.encodeSync(CartCookieJson)(cart), {
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 10,
            path: "/",
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }),
    });
  })
);

/** The existing storefront binds provider persistence to this request's cookies. */
export const cartStorageLayerWith = <R>(
  buyer: Effect.Effect<ShopifyCartBuyer, never, R>
) => storageLayerWith(buyer).pipe(Layer.provide(nextCartPersistenceLayer));

export const cartStorageLayer = cartStorageLayerWith(
  Effect.succeed({ accessToken: Effect.succeed(undefined) })
);
export const currentCartLayer = CurrentCart.layerFromStorage.pipe(
  Layer.provide(cartStorageLayer)
);
