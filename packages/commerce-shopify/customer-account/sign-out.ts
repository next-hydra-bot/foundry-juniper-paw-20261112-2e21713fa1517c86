import "server-only";
import { NextRequestApi } from "@repo/actions/next-request";
import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import { Effect, Exit } from "effect";

import { ShopifyCartSession } from "../cart/session";
import { ShopifyCustomerAccounts } from "./accounts";
import { authenticatedCartStorageLayer } from "./cart";
import { isSameOriginLogout, logoutRequestOrigin } from "./logout";

/** Capture Shopify's logout hint while the site's original session can still decrypt it. */
export async function prepareSignOutForRequest(
  request: Request
): Promise<string> {
  if (!isSameOriginLogout(request)) {
    throw new Error("Sign-out requires a same-origin POST.");
  }
  const destination = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const next = yield* NextRequestApi;
      const locale = yield* next.getLocale();
      const detached = yield* ShopifyCartSession.pipe(
        Effect.flatMap((session) => session.detachBuyer()),
        Effect.provide(authenticatedCartStorageLayer),
        NextCommerce.provide(locale),
        Effect.exit
      );
      if (Exit.isFailure(detached)) {
        // Local credentials are still discarded below; never retry an ambiguous cart mutation.
        yield* Effect.logWarning(
          "Shopify cart detachment could not be confirmed during sign-out."
        );
      }
      const accounts = yield* ShopifyCustomerAccounts;
      return (yield* accounts.handle(request)).destination;
    })
  );
  return new URL(destination, logoutRequestOrigin(request)).href;
}
