import {
  CustomerArea,
  CustomerAreaNavigation,
} from "@repo/design-system/components/layout/customer-area";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { customerAccountNavigation } from "./navigation";
import { AccountNavigation } from "./navigation-client";

/** Persistent presentation only. Pages and actions retain their own authorization. */
export async function CustomerAccountLayout({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  await connection();
  const [t, items] = await Promise.all([
    getTranslations({ locale, namespace: "web.customerArea.overview" }),
    customerAccountNavigation(locale),
  ]);
  return (
    <CustomerArea
      title={t("account")}
      description={t("description")}
      navigation={
        <Suspense
          fallback={
            <CustomerAreaNavigation items={items} label={t("account")} />
          }
        >
          <AccountNavigation
            items={items}
            label={t("account")}
            rootHref={`/${locale}/account`}
          />
        </Suspense>
      }
    >
      {children}
    </CustomerArea>
  );
}
