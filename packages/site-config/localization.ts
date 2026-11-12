import type { LocalizationConfig } from "./schema";

export const localization = {
  "defaultLocale": "en-US",
  "locales": [
    "en-US",
    "en-CA",
    "fr-CA"
  ],
  "storefronts": [
    {
      "storeKey": "default-store",
      "locale": "en-US",
      "country": "US",
      "currency": "USD",
      "isDefault": true,
      "displayName": "United States (English)"
    },
    {
      "storeKey": "canada",
      "locale": "en-CA",
      "country": "CA",
      "currency": "CAD",
      "isDefault": true,
      "displayName": "Canada (English)"
    },
    {
      "storeKey": "canada",
      "locale": "fr-CA",
      "country": "CA",
      "currency": "CAD",
      "isDefault": true,
      "displayName": "Canada (français)"
    }
  ]
} as const satisfies LocalizationConfig;
