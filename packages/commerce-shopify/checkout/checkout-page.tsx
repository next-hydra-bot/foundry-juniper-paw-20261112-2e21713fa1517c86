import { NextCommerce } from "@repo/commerce-shopify/checkout/bindings";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import { redirect } from "next/navigation";

import { startCheckout } from "./programs";

export async function checkoutResult(
  destination: "emptyCart" | "cartPolicy" | `https://${string}`,
  locale: Locale
) {
  if (destination === "emptyCart") {
    const t = await getTranslations({ locale, namespace: "web.cart" });
    return (
      <p role="status" className="mx-auto max-w-4xl px-4 py-8">
        {t("empty.heading")}
      </p>
    );
  }
  if (destination === "cartPolicy") {
    const t = await getTranslations({ locale, namespace: "web.checkout" });
    return (
      <p role="alert" className="mx-auto max-w-4xl px-4 py-8">
        {t("violations.generic")}
      </p>
    );
  }
  return redirect(destination);
}

export async function CheckoutPage({ locale }: { readonly locale: Locale }) {
  const destination = await NextCommerce.runPromise(
    startCheckout().pipe(
      Effect.catchTag("ShopifyCheckoutUnavailable", (error) =>
        Effect.succeed(error.reason)
      ),
      NextCommerce.provide(locale)
    )
  );
  return await checkoutResult(destination, locale);
}
