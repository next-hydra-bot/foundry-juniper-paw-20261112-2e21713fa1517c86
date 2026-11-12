import { withAuth, getAuthRoutes } from "@repo/auth/server";
import { CustomerAccountHome } from "@repo/commerce-core/customer-account/home";
import { AccountHomeSkeleton } from "@repo/commerce-core/customer-account/loading";
import { hasLocale, setRequestLocale } from "@repo/i18n";
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
  // oxlint-disable-next-line typescript/no-deprecated -- Match the application's locale route contract.
  setRequestLocale(locale);
  const auth = { readSession: withAuth, routes: getAuthRoutes };
  return (
    <Suspense fallback={<AccountHomeSkeleton />}>
      <CustomerAccountHome locale={locale} auth={auth} />
    </Suspense>
  );
}
