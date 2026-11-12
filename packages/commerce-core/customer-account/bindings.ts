import type { CustomerAreaNavigationItem } from "@repo/design-system/components/layout/customer-area";
import type { Locale } from "@repo/i18n/types";

/** The application recipe supplies installed account sections through this module binding. */
export type CustomerAccountSection = (
  locale: Locale
) => Promise<readonly CustomerAreaNavigationItem[]>;
export const accountNavigationSections: readonly CustomerAccountSection[] = [];
