import type { LocalizationConfig } from "./schema";

const locales = [
  "en-US",
  "en-GB",
  "es-ES",
  "fr-FR",
  "de-DE",
  "it-IT",
  "pt-PT",
  "nl-NL",
] as const;

/** Store and language settings for commerce scenarios with US and European markets. */
export const localization = {
  defaultLocale: "en-US",
  locales,
  storefronts: locales.map((locale) => ({
    locale,
    country: locale.slice(-2),
    currency: locale === "en-US" ? "USD" : locale === "en-GB" ? "GBP" : "EUR",
    storeKey: ["en-GB", "fr-FR", "de-DE"].includes(locale)
      ? "de-fr-uk"
      : "default-store",
    isDefault: true,
  })),
} satisfies LocalizationConfig;
