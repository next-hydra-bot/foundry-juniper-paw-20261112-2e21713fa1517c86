import { withAuth, getAuthRoutes } from "@repo/auth/server";
import { OrderDetailSkeleton } from "@repo/commerce-core/orders/loading";
import { orderIdFromRoute } from "@repo/commerce-core/orders/pages";
import type { OrderSearchParams } from "@repo/commerce-core/orders/pages";
import { CustomerOrderDetailPage } from "@repo/commerce-provider/customer-account/order-pages";
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
  const { locale, id } = await params;
  const orderId = orderIdFromRoute(id);
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Uses the current locale route contract.
  setRequestLocale(locale);
  if (!orderId) notFound();
  return (
    <CustomerOrderDetailPage
      auth={auth}
      locale={locale}
      orderId={orderId}
      searchParams={await searchParams}
    />
  );
}

export default function Orders(props: Parameters<typeof OrderPage>[0]) {
  return (
    <Suspense fallback={<OrderDetailSkeleton />}>
      <OrderPage {...props} />
    </Suspense>
  );
}
