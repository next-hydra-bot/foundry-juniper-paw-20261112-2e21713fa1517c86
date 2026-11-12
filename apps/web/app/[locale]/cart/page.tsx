import { CartPage } from "@repo/commerce-core/cart/page";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";

import { cartLinks } from "@/lib/cart-links";

export default async function Page({ params }: PageProps<"/[locale]/cart">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the repository's current next-intl static-rendering contract until its root-params migration lands.
  setRequestLocale(locale);
  return <CartPage {...cartLinks} />;
}
