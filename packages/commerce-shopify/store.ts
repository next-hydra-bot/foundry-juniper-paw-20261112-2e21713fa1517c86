import {
  CommerceLocale,
  StoreKey,
  storeConfiguration,
  validateStoreConfiguration,
} from "@repo/commerce-core/store";
import type { Store, StoreConfiguration } from "@repo/commerce-core/store";
import { localization } from "@repo/site-config";
import type { I18nConfig } from "@shopify/hydrogen";

export interface ShopifyMarketConfiguration {
  readonly key: string;
  readonly handle: string;
  readonly name: string;
  readonly currency: Store["currency"];
  readonly countries: readonly I18nConfig["country"][];
}

export interface ShopifyStoreMapping {
  readonly storeKey: StoreKey;
  readonly locale: CommerceLocale;
  readonly marketKey: string;
  readonly country: I18nConfig["country"];
  readonly language: I18nConfig["language"];
}

export interface ShopifyConfiguration {
  readonly markets: readonly ShopifyMarketConfiguration[];
  readonly stores: readonly ShopifyStoreMapping[];
}

// Preserve the handles of the starter Shopify Markets on existing workspaces.
const starterMarkets: readonly ShopifyMarketConfiguration[] = [
  {
    countries: ["US"],
    currency: "USD",
    handle: "us",
    key: "north-america",
    name: "United States",
  },
  {
    countries: ["GB"],
    currency: "GBP",
    handle: "united-kingdom",
    key: "united-kingdom",
    name: "United Kingdom",
  },
  {
    countries: ["DE", "ES", "FR", "IT", "NL", "PT"],
    currency: "EUR",
    handle: "europe",
    key: "europe",
    name: "Europe",
  },
];

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const markets = new Map<string, ShopifyMarketConfiguration>();
const stores = localization.storefronts.map((store): ShopifyStoreMapping => {
  const country = store.country as I18nConfig["country"];
  const tag = new Intl.Locale(store.locale);
  const language = (
    tag.baseName === "pt-PT" ? "PT_PT" : tag.language.toUpperCase()
  ) as I18nConfig["language"];
  const starter = starterMarkets.find(
    (market) =>
      market.currency === store.currency && market.countries.includes(country)
  );
  const marketKey = starter?.key ?? country.toLowerCase();
  const current = markets.get(marketKey);
  const name = starter?.name ?? regionNames.of(country) ?? country;
  markets.set(marketKey, {
    countries: [...new Set([...(current?.countries ?? []), country])],
    currency: current?.currency ?? store.currency,
    handle:
      starter?.handle ??
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, ""),
    key: marketKey,
    name,
  });
  return {
    country,
    language,
    locale: CommerceLocale.make(store.locale),
    marketKey,
    storeKey: StoreKey.make(store.storeKey),
  };
});

export const shopifyConfiguration: ShopifyConfiguration = {
  markets: [...markets.values()],
  stores,
};

export const validateShopifyConfiguration = (
  configuration: ShopifyConfiguration,
  stores: StoreConfiguration = storeConfiguration
): void => {
  validateStoreConfiguration(stores);
  const markets = new Map<string, ShopifyMarketConfiguration>();
  const handles = new Set<string>();
  const countries = new Set<string>();
  for (const market of configuration.markets) {
    if (
      !market.key ||
      !market.handle ||
      markets.has(market.key) ||
      handles.has(market.handle)
    ) {
      throw new Error(
        "Shopify Market keys and handles must be nonempty and unique"
      );
    }
    if (
      !market.countries.length ||
      market.countries.some((country) => countries.has(country))
    ) {
      throw new Error(
        `Shopify Market ${market.key} must declare distinct countries not assigned to another Market`
      );
    }
    for (const country of market.countries) {
      if (countries.has(country)) {
        throw new Error(
          `Shopify Market ${market.key} repeats country ${country}`
        );
      }
      countries.add(country);
    }
    markets.set(market.key, market);
    handles.add(market.handle);
  }
  const storeLocales = new Set<string>();
  for (const mapping of configuration.stores) {
    const identity = `${mapping.storeKey}/${mapping.locale}`;
    if (storeLocales.has(identity)) {
      throw new Error(`Duplicate Shopify Store mapping for ${identity}`);
    }
    storeLocales.add(identity);
    const store = stores.find(
      ({ storeKey, locale }) =>
        storeKey === mapping.storeKey && locale === mapping.locale
    );
    const market = markets.get(mapping.marketKey);
    if (
      !store ||
      !market ||
      market.currency !== store.currency ||
      !market.countries.includes(mapping.country)
    ) {
      throw new Error(
        `Shopify Store ${identity} must reference a Core Store and a Market with its declared country and currency`
      );
    }
  }
  for (const store of stores) {
    if (!storeLocales.has(`${store.storeKey}/${store.locale}`)) {
      throw new Error(
        `Missing Shopify Store mapping for ${store.storeKey}/${store.locale}`
      );
    }
  }
};

validateShopifyConfiguration(shopifyConfiguration);

/** Resolve the complete selling context. Locale alone never selects a native Market. */
export const storefrontContext = (
  store: Store,
  configuration: ShopifyConfiguration = shopifyConfiguration,
  stores: StoreConfiguration = storeConfiguration
): I18nConfig => {
  validateShopifyConfiguration(configuration, stores);
  const mapping = configuration.stores.find(
    (candidate) =>
      candidate.storeKey === store.storeKey && candidate.locale === store.locale
  );
  const configured = stores.find(
    ({ storeKey, locale }) =>
      storeKey === store.storeKey && locale === store.locale
  );
  if (!mapping || configured?.currency !== store.currency) {
    throw new Error(
      `Shopify Store mapping is not configured for ${store.storeKey}/${store.locale}/${store.currency}`
    );
  }
  return { country: mapping.country, language: mapping.language };
};
