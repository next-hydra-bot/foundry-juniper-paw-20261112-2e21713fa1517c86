export interface StorefrontConfig {
  readonly storeKey: string;
  readonly locale: string;
  readonly country: string;
  readonly currency: string;
  readonly isDefault: boolean;
  readonly displayCode?: string;
  readonly displayName?: string;
}

export interface LocalizationConfig {
  readonly defaultLocale: string;
  readonly locales: readonly [string, ...string[]];
  readonly storefronts: readonly StorefrontConfig[];
}

export const localeTagPattern = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

export function validateLocalization(config: LocalizationConfig): void {
  const locales = new Set(config.locales);
  if (
    locales.size !== config.locales.length ||
    config.locales.some(
      (locale) => Intl.getCanonicalLocales(locale)[0] !== locale
    )
  ) {
    throw new Error("Site locales must be unique canonical language tags.");
  }
  if (!locales.has(config.defaultLocale)) {
    throw new Error(
      `The default locale ${config.defaultLocale} must be active.`
    );
  }
  const identities = new Set<string>();
  const defaults = new Set<string>();
  for (const store of config.storefronts) {
    const identity = `${store.storeKey}/${store.locale}`;
    if (!locales.has(store.locale) || identities.has(identity)) {
      throw new Error(`Duplicate or inactive storefront mapping: ${identity}.`);
    }
    if (
      !/^[A-Z]{2}$/u.test(store.country) ||
      !/^[A-Z]{3}$/u.test(store.currency)
    ) {
      throw new Error(`Use an ISO country and currency for ${identity}.`);
    }
    identities.add(identity);
    if (store.isDefault) {
      if (defaults.has(store.locale)) {
        throw new Error(`Multiple default Stores for ${store.locale}.`);
      }
      defaults.add(store.locale);
    }
  }
  if (config.storefronts.length > 0) {
    for (const locale of locales) {
      if (!defaults.has(locale))
        throw new Error(`Missing default Store for ${locale}.`);
    }
  }
}
