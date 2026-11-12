import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import { redirect } from "next/navigation";

import { ShopifyCartSession } from "../cart/session";
import { checkoutResult } from "../checkout/checkout-page";
import { checkoutDestination } from "../checkout/programs";
import { ShopifyCustomerAccounts } from "./accounts";
import { authenticatedCartStorageLayer } from "./cart";

export async function CheckoutPage({ locale }: { readonly locale: Locale }) {
  const authentication = await NextCommerce.runPromise(
    ShopifyCustomerAccounts.pipe(
      Effect.flatMap((accounts) =>
        accounts.checkoutDestination(`/${locale}/checkout`)
      )
    )
  );
  if (authentication) {
    redirect(authentication);
  }
  const destination = await NextCommerce.runPromise(
    ShopifyCartSession.pipe(
      Effect.flatMap((session) =>
        session.buyerSynchronizationPending.pipe(
          Effect.flatMap((pending) =>
            pending ? Effect.succeed("refresh" as const) : checkoutDestination
          )
        )
      ),
      Effect.provide(authenticatedCartStorageLayer),
      Effect.catchTag("ShopifyCheckoutUnavailable", (error) =>
        Effect.succeed(error.reason)
      ),
      NextCommerce.provide(locale)
    )
  );
  if (destination === "refresh") {
    redirect(
      `/account/refresh?${new URLSearchParams({ return_to: `/${locale}/checkout` })}`
    );
  }
  return await checkoutResult(destination, locale);
}
