import { CheckoutPage } from "@repo/commerce-provider/customer-account/checkout-page";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";

export default async function Checkout({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the workspace locale route contract.
  setRequestLocale(locale);
  return <CheckoutPage locale={locale} />;
}
