import type { NextCookieStore } from "@repo/actions/next-request";
/* oxlint-disable promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Effect combinators use callback APIs to transform Effect values. */
import "server-only";
import { CartId } from "@repo/commerce-core/domain/cart";
import {
  AnonymousCommerceContextRequest,
  B2CPurchasingContextRequest,
} from "@repo/commerce-core/domain/commerce-request-context";
import {
  ANONYMOUS_CART_COOKIE_NAME,
  getAnonymousCartIdFromCookieValue,
} from "@repo/commerce-core/lib/cart/utils/anonymous-cart-cookies";
import { decodeCommerceAuthUserId } from "@repo/commerce-core/runtime/commerce-request";
import type { CommerceRequestInput } from "@repo/commerce-core/runtime/commerce-request";
import { makeCurrentCartCookie } from "@repo/commerce-core/runtime/current-cart-cookie";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import type { StoreConfiguration, StoreKey } from "@repo/commerce-core/store";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";

export interface B2CPurchasingRequestOptions {
  readonly selectedStoreKey?: StoreKey;
  readonly storeConfiguration?: StoreConfiguration;
}

export const makeB2CPurchasingRequest = (
  locale: Locale,
  cookieStore: NextCookieStore,
  authUserId: string | undefined,
  options?: B2CPurchasingRequestOptions
) => {
  const commerceLocale = CommerceLocale.make(locale);
  const store =
    options?.selectedStoreKey === undefined
      ? resolveStore({ locale: commerceLocale }, options?.storeConfiguration)
      : resolveStore(
          {
            locale: commerceLocale,
            selectedStoreKey: options.selectedStoreKey,
          },
          options.storeConfiguration
        );
  const anonymousCartId = getAnonymousCartIdFromCookieValue(
    cookieStore.get(ANONYMOUS_CART_COOKIE_NAME)?.value,
    store
  );

  return decodeCommerceAuthUserId(authUserId).pipe(
    Effect.map((decodedAuthUserId): CommerceRequestInput => {
      if (decodedAuthUserId === undefined) {
        const anonymousContext: ConstructorParameters<
          typeof AnonymousCommerceContextRequest
        >[0] = { store };
        if (anonymousCartId !== null) {
          Object.assign(anonymousContext, {
            anonymousCartId: CartId.make(anonymousCartId),
          });
        }

        return {
          context: new AnonymousCommerceContextRequest(anonymousContext),
          currentCartCookie: makeCurrentCartCookie(cookieStore, store),
        };
      }

      return {
        context: new B2CPurchasingContextRequest({
          authUserId: decodedAuthUserId,
          store,
        }),
        currentCartCookie: makeCurrentCartCookie(cookieStore, store),
      };
    })
  );
};

/** Guest purchasing ignores an independent site authentication session. */
export const makeGuestPurchasingRequest = (
  locale: Locale,
  cookies: NextCookieStore,
  _authUserId: string | undefined,
  options?: B2CPurchasingRequestOptions
) => makeB2CPurchasingRequest(locale, cookies, undefined, options);
