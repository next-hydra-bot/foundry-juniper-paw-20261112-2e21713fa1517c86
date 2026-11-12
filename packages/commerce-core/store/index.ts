import { localeTagPattern, localization } from "@repo/site-config";
import { Schema } from "effect";

import { CurrencyCode } from "../domain/money";

export const CommerceLocale = Schema.String.check(
  Schema.isPattern(localeTagPattern)
).pipe(Schema.brand("CommerceLocale"));
export type CommerceLocale = typeof CommerceLocale.Type;

/** Stable selling-context identity, independent of locale, currency and pricing group. */
export const StoreKey = Schema.NonEmptyString.pipe(Schema.brand("StoreKey"));
export type StoreKey = typeof StoreKey.Type;

/** The selected Store's current presentation and selling settings. */
export class Store extends Schema.Class<Store>("Store")({
  currency: CurrencyCode,
  locale: CommerceLocale,
  storeKey: StoreKey,
}) {}

export interface ConfiguredStore {
  readonly storeKey: StoreKey;
  readonly locale: CommerceLocale;
  readonly currency: CurrencyCode;
  readonly isDefault: boolean;
  readonly country?: string | undefined;
  readonly displayCode?: string | undefined;
  readonly displayName?: string | undefined;
}

export type StoreConfiguration = readonly ConfiguredStore[];

// Currency belongs to the selling context; it is not inferred from its locale.
export const storeConfiguration: StoreConfiguration = Schema.decodeSync(
  Schema.Array(
    Schema.Struct({
      ...Store.fields,
      country: Schema.optional(Schema.NonEmptyString),
      displayCode: Schema.optional(Schema.NonEmptyString),
      displayName: Schema.optional(Schema.NonEmptyString),
      isDefault: Schema.Boolean,
    })
  )
)(localization.storefronts);

export const validateStoreConfiguration = (
  configuration: readonly {
    storeKey: string;
    locale: string;
    isDefault: boolean;
  }[]
): void => {
  const selections = new Set<string>();
  const defaults = new Map<string, number>();
  for (const store of configuration) {
    const selection = `${store.storeKey}/${store.locale}`;
    if (selections.has(selection)) {
      throw new Error(`Duplicate Store mapping for ${selection}`);
    }
    selections.add(selection);
    defaults.set(
      store.locale,
      (defaults.get(store.locale) ?? 0) + Number(store.isDefault)
    );
  }
  for (const [locale, count] of defaults) {
    if (count !== 1) {
      throw new Error(
        `Exactly one default Store is required for locale ${locale}`
      );
    }
  }
};

validateStoreConfiguration(storeConfiguration);

export interface StoreSelection {
  readonly locale: CommerceLocale;
  readonly selectedStoreKey?: StoreKey;
}

export const resolveStore = (
  selection: StoreSelection,
  configuration: StoreConfiguration = storeConfiguration
): Store => {
  validateStoreConfiguration(configuration);
  const eligibleStores = configuration.filter(
    ({ locale }) => locale === selection.locale
  );
  const selectedStore =
    selection.selectedStoreKey === undefined
      ? undefined
      : eligibleStores.find(
          ({ storeKey }) => storeKey === selection.selectedStoreKey
        );
  const resolvedStore =
    selectedStore ?? eligibleStores.find(({ isDefault }) => isDefault);

  if (resolvedStore === undefined) {
    throw new Error(
      `A default Store is not configured for locale ${selection.locale}`
    );
  }

  return new Store({
    currency: resolvedStore.currency,
    locale: resolvedStore.locale,
    storeKey: resolvedStore.storeKey,
  });
};
