import { NextRequestApi } from "@repo/actions/next-request";
import { StoreKey } from "@repo/commerce-core/store";
import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import { routing } from "@repo/i18n/routing";
import { Effect, Option, Result, Schema } from "effect";

import { CartCookieJson } from "../cart/schema";
import { ShopifyCartSession, CART_COOKIE_NAME } from "../cart/session";
import { ShopifyCustomerAccounts } from "./accounts";
import { authenticatedCartStorageLayer } from "./cart";
import { LOGOUT_COMPLETION_PATH, LOGOUT_CONTINUATION_PATH } from "./logout";

const documentNavigationPaths = new Set([
  "/account/login",
  "/account/authorize",
  "/account/refresh",
  LOGOUT_CONTINUATION_PATH,
  LOGOUT_COMPLETION_PATH,
]);

/** Thin application routes re-export this package-owned transport. */
export const GET = async (request: Request): Promise<Response> => {
  const headers = {
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  };
  const { pathname } = new URL(request.url);
  const destination = request.headers.get("sec-fetch-dest");
  const purpose =
    request.headers.get("sec-purpose") ?? request.headers.get("purpose");
  if (
    documentNavigationPaths.has(pathname) &&
    (request.headers.has("rsc") ||
      request.headers.has("next-router-prefetch") ||
      purpose?.includes("prefetch") ||
      (destination !== null && destination !== "document"))
  ) {
    // OAuth transitions require a document request. Background requests must not
    // replace pending state or consume one-use cookies/codes before browser navigation.
    return new Response(null, { headers, status: 409 });
  }
  const result = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ShopifyCustomerAccounts;
      const outcome = yield* accounts.handle(request);
      if (outcome.synchronizeCart) {
        const next = yield* NextRequestApi;
        const cookies = yield* next.getCookies();
        const encoded = cookies.get(CART_COOKIE_NAME)?.value;
        const cart = encoded
          ? Option.getOrUndefined(Schema.decodeOption(CartCookieJson)(encoded))
          : undefined;
        // OAuth callbacks have no locale segment. Preserve the guest cart's Market during attachment.
        const cartLocale =
          routing.locales.find((locale) => locale === cart?.locale) ??
          routing.locales.find(
            (locale) =>
              outcome.destination.startsWith(`/${locale}/`) ||
              outcome.destination === `/${locale}`
          );
        const locale = cartLocale ?? (yield* next.getLocale());
        const synchronized = yield* ShopifyCartSession.pipe(
          Effect.flatMap((session) => session.synchronizeBuyer()),
          Effect.provide(authenticatedCartStorageLayer),
          NextCommerce.provide(locale, {
            selectedStoreKey:
              cartLocale && cart
                ? Option.getOrUndefined(
                    Schema.decodeOption(StoreKey)(cart.storeKey)
                  )
                : undefined,
          }),
          Effect.as(true),
          Effect.catchTag("CartProviderFailure", (error) =>
            error.reason === "unavailable"
              ? Effect.succeed(false)
              : Effect.fail(error)
          )
        );
        if (!synchronized) {
          // Retry a writable cart connection, never the already consumed OAuth code.
          const retryHref = `/account/refresh?${new URLSearchParams({ return_to: outcome.destination })}`;
          return new Response(
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>Retry checkout</title><main><h1>Your cart needs connecting</h1><p>You're signed in, but we couldn't connect your cart to your customer account. Your cart has been kept.</p><a href="${retryHref}">Retry checkout</a></main></html>`,
            {
              headers: {
                ...headers,
                "content-type": "text/html; charset=utf-8",
              },
              status: 503,
            }
          );
        }
      }
      return new Response(null, {
        headers: { ...headers, location: outcome.destination },
        status: 303,
      });
    }).pipe(Effect.result)
  );
  if (Result.isFailure(result)) {
    return new Response(
      "Customer authentication could not be completed. Please retry sign-in.",
      { headers, status: 503 }
    );
  }
  return result.success;
};
