import { localization } from "@repo/site-config/localization";
import { validateLocalization } from "@repo/site-config/schema";

validateLocalization(localization);

export { localization };
export { localeTagPattern } from "@repo/site-config/schema";
export type {
  LocalizationConfig,
  StorefrontConfig,
} from "@repo/site-config/schema";
export type SiteLocale = (typeof localization.locales)[number];
export type SiteStoreKey = Extract<
  (typeof localization.storefronts)[number],
  { storeKey: string }
>["storeKey"];
