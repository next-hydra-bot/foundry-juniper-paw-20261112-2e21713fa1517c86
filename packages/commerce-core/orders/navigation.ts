import type { CustomerAreaNavigationItem } from "@repo/design-system/components/layout/customer-area";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";

export const orderHistoryNavigation = async (
  locale: Locale
): Promise<readonly CustomerAreaNavigationItem[]> => {
  const t = await getTranslations({
    locale,
    namespace: "web.customerArea.navigation",
  });
  return [{ href: `/${locale}/account/orders`, label: t("orders") }];
};
