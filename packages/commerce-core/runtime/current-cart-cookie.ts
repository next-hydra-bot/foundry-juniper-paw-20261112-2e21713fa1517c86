import type { NextCookieStore } from "@repo/actions/next-request";
import { Effect } from "effect";

import { currentCartOperationFailure } from "../domain/cart-errors";
import {
  ANONYMOUS_CART_COOKIE_NAME,
  ANONYMOUS_CART_COOKIE_OPTIONS,
  encodeAnonymousCartCookie,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This pure factory creates a cookie value, not an Effect service.
  makeAnonymousCartCookie,
} from "../lib/cart/utils/anonymous-cart-cookies";
import type { CurrentCartCookie } from "../lib/current-cart/cookie";
import type { Store } from "../store";

/** Shared persistence for providers whose anonymous carts use the Core cart cookie. */
export const makeCurrentCartCookie = (
  cookieStore: NextCookieStore,
  store: Store
): CurrentCartCookie => {
  const currentCartCookie: CurrentCartCookie = {
    clear: () =>
      Effect.sync(() => {
        cookieStore.delete(ANONYMOUS_CART_COOKIE_NAME);
      }).pipe(
        Effect.catchDefect(() => Effect.void),
        Effect.asVoid
      ),
    set: (cartId) =>
      Effect.try({
        catch: currentCartOperationFailure,
        try: () => {
          cookieStore.set(
            ANONYMOUS_CART_COOKIE_NAME,
            encodeAnonymousCartCookie(
              makeAnonymousCartCookie({ cartId, store })
            ),
            ANONYMOUS_CART_COOKIE_OPTIONS
          );
        },
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("Failed to persist the anonymous cart cookie", error)
        ),
        Effect.orDie,
        Effect.asVoid
      ),
  };
  return currentCartCookie;
};
