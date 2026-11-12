import { CustomerAccountLayout } from "@repo/commerce-core/customer-account/layout";
import { CustomerAreaSkeleton } from "@repo/design-system/components/layout/customer-area";
import { hasLocale, setRequestLocale } from "@repo/i18n";
import { routing } from "@repo/i18n/routing";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

async function AccountLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  // oxlint-disable-next-line typescript/no-deprecated -- Match the application's locale route contract.
  setRequestLocale(locale);
  return (
    <CustomerAccountLayout locale={locale}>{children}</CustomerAccountLayout>
  );
}
export default function Layout(props: Parameters<typeof AccountLayout>[0]) {
  return (
    <Suspense fallback={<CustomerAreaSkeleton />}>
      <AccountLayout {...props} />
    </Suspense>
  );
}
