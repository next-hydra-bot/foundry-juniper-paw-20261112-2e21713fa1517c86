import { withAuth, getAuthRoutes } from "@repo/auth/server";
import { OrderListingSkeleton } from "@repo/commerce-core/orders/loading";
import type { OrderSearchParams } from "@repo/commerce-core/orders/pages";
import { CustomerOrderListingPage } from "@repo/commerce-provider/customer-account/order-pages";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const auth = { readSession: withAuth, routes: getAuthRoutes };

async function OrderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id?: string }>;
  readonly searchParams: Promise<OrderSearchParams>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Uses the current locale route contract.
  setRequestLocale(locale);
  return (
    <CustomerOrderListingPage
      auth={auth}
      locale={locale}
      searchParams={await searchParams}
    />
  );
}

export default function Orders(props: Parameters<typeof OrderPage>[0]) {
  return (
    <Suspense fallback={<OrderListingSkeleton />}>
      <OrderPage {...props} />
    </Suspense>
  );
}
