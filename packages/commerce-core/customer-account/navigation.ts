import { accountNavigationSections } from "@repo/commerce-core/customer-account/bindings";
import type { CustomerAreaNavigationItem } from "@repo/design-system/components/layout/customer-area";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";

/** The account layout resolves installed destinations once; the client selects the active segment. */
export const customerAccountNavigation = async (
  locale: Locale
): Promise<readonly CustomerAreaNavigationItem[]> => {
  const t = await getTranslations({
    locale,
    namespace: "web.customerArea.navigation",
  });
  const sections = await Promise.all(
    accountNavigationSections.map(async (section) => await section(locale))
  );
  const items: readonly CustomerAreaNavigationItem[] = [
    { href: `/${locale}/account`, label: t("overview") },
    ...sections.flat(),
  ];
  return items;
};

export type { CustomerAccountSection } from "./bindings";
