import { EmailOrderPage } from "@repo/commerce-core/orders/email-page";
import { EmailOrderDetailSkeleton } from "@repo/commerce-core/orders/loading";
import { orderIdFromRoute } from "@repo/commerce-core/orders/pages";
import { loadEmailOrder } from "@repo/commerce-provider/orders/email-runtime";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function OrderPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const { locale, id } = await params;
  const orderId = orderIdFromRoute(id);
  if (!hasLocale(routing.locales, locale) || !orderId) notFound();
  // oxlint-disable-next-line typescript/no-deprecated -- Uses the current locale route contract.
  setRequestLocale(locale);
  return (
    <EmailOrderPage locale={locale} orderId={orderId} load={loadEmailOrder} />
  );
}

export default function Order(props: Parameters<typeof OrderPage>[0]) {
  return (
    <Suspense fallback={<EmailOrderDetailSkeleton />}>
      <OrderPage {...props} />
    </Suspense>
  );
}
