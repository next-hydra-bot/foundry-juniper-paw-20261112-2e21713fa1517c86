import { withAuth, getAuthRoutes } from "@repo/auth/server";
import { CustomerProfileSkeleton } from "@repo/commerce-b2c/customer-account/loading";
import { CustomerAccountProfilePage } from "@repo/commerce-provider/customer-account/account-page";
import { hasLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export default async function Account({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const auth = { readSession: withAuth, routes: getAuthRoutes };
  return (
    <Suspense fallback={<CustomerProfileSkeleton />}>
      <CustomerAccountProfilePage locale={locale} auth={auth} />
    </Suspense>
  );
}
