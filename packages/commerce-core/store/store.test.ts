import { describe, expect, it } from "vitest";

import { CurrencyCode } from "../domain/money";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
  StoreKey,
  validateStoreConfiguration,
} from "./index";
import type { StoreConfiguration } from "./index";

const enUs = CommerceLocale.make("en-US");
const selectableStores = [
  {
    currency: CurrencyCode.make("USD"),
    isDefault: true,
    locale: enUs,
    storeKey: StoreKey.make("default-store"),
  },
  {
    currency: CurrencyCode.make("EUR"),
    isDefault: false,
    locale: enUs,
    storeKey: StoreKey.make("wholesale-store"),
  },
  {
    currency: CurrencyCode.make("GBP"),
    isDefault: true,
    locale: CommerceLocale.make("en-GB"),
    storeKey: StoreKey.make("europe-store"),
  },
] satisfies StoreConfiguration;

describe(resolveStore, () => {
  it("resolves the locale's configured default Store", () => {
    for (const { locale, currency, storeKey } of storeConfiguration.filter(
      ({ isDefault }) => isDefault
    )) {
      expect(resolveStore({ locale })).toEqual({ currency, locale, storeKey });
    }
  });

  it("resolves an explicitly selected eligible Store", () => {
    const store = resolveStore(
      {
        locale: enUs,
        selectedStoreKey: StoreKey.make("wholesale-store"),
      },
      selectableStores
    );

    expect(store).toEqual({
      currency: "EUR",
      locale: "en-US",
      storeKey: "wholesale-store",
    });
  });

  it("falls back when a configured Store is not eligible for the locale", () => {
    const store = resolveStore(
      {
        locale: enUs,
        selectedStoreKey: StoreKey.make("europe-store"),
      },
      selectableStores
    );

    expect(store.storeKey).toBe("default-store");
  });

  it("falls back when a selected Store is not configured", () => {
    const store = resolveStore(
      {
        locale: enUs,
        selectedStoreKey: StoreKey.make("tampered-store"),
      },
      selectableStores
    );

    expect(store.storeKey).toBe("default-store");
  });
});

describe(validateStoreConfiguration, () => {
  it("rejects duplicate Store and locale combinations", () => {
    expect(() => {
      validateStoreConfiguration([...selectableStores, ...selectableStores]);
    }).toThrow("Duplicate Store mapping");
  });

  it("requires one explicit default Store for every configured locale", () => {
    expect(() => {
      validateStoreConfiguration(
        selectableStores.map((store) => ({ ...store, isDefault: true }))
      );
    }).toThrow("Exactly one default Store");
    expect(() => {
      validateStoreConfiguration(
        selectableStores.map((store) => ({ ...store, isDefault: false }))
      );
    }).toThrow("Exactly one default Store");
  });
});
