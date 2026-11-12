import {
  CommerceLocale,
  resolveStore,
  Store,
  StoreKey,
  storeConfiguration,
} from "@repo/commerce-core/store";
import type { StoreConfiguration } from "@repo/commerce-core/store";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  shopifyConfiguration,
  storefrontContext,
  validateShopifyConfiguration,
} from "./store";
import type { ShopifyConfiguration } from "./store";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const stores: StoreConfiguration = [
  {
    currency: "EUR",
    isDefault: true,
    locale: CommerceLocale.make("en-US"),
    storeKey: StoreKey.make("retail"),
  },
  {
    currency: "EUR",
    isDefault: false,
    locale: CommerceLocale.make("en-US"),
    storeKey: StoreKey.make("wholesale"),
  },
  {
    currency: "EUR",
    isDefault: true,
    locale: CommerceLocale.make("fr-FR"),
    storeKey: StoreKey.make("retail"),
  },
];
const configuration: ShopifyConfiguration = {
  markets: [
    {
      countries: ["FR"],
      currency: "EUR",
      handle: "france",
      key: "france",
      name: "France",
    },
    {
      countries: ["DE"],
      currency: "EUR",
      handle: "germany",
      key: "germany",
      name: "Germany",
    },
  ],
  stores: [
    {
      country: "FR",
      language: "EN",
      locale: CommerceLocale.make("en-US"),
      marketKey: "france",
      storeKey: StoreKey.make("retail"),
    },
    {
      country: "DE",
      language: "EN",
      locale: CommerceLocale.make("en-US"),
      marketKey: "germany",
      storeKey: StoreKey.make("wholesale"),
    },
    {
      country: "FR",
      language: "FR",
      locale: CommerceLocale.make("fr-FR"),
      marketKey: "france",
      storeKey: StoreKey.make("retail"),
    },
  ],
};
const select = (storeKey: string, locale: "en-US" | "fr-FR" = "en-US") =>
  resolveStore(
    {
      locale: CommerceLocale.make(locale),
      selectedStoreKey: StoreKey.make(storeKey),
    },
    stores
  );

describe("explicit Shopify Store mappings", () => {
  it("uses the bundled Core Store defaults", () => {
    const store = resolveStore(
      { locale: CommerceLocale.make("en-GB") },
      storeConfiguration
    );
    expect(store).toEqual({
      currency: "GBP",
      locale: "en-GB",
      storeKey: "de-fr-uk",
    });
    expect(storefrontContext(store)).toEqual({ country: "GB", language: "EN" });
  });

  it("selects native context by the Core Store and locale without deriving country or currency", () => {
    expect(select("retail").currency).toBe("EUR");
    expect(storefrontContext(select("retail"), configuration, stores)).toEqual({
      country: "FR",
      language: "EN",
    });
    expect(
      storefrontContext(select("wholesale"), configuration, stores)
    ).toEqual({ country: "DE", language: "EN" });
    expect(
      storefrontContext(select("retail", "fr-FR"), configuration, stores)
    ).toEqual({ country: "FR", language: "FR" });
  });

  it("rejects unknown Store identities and currency mismatches instead of falling back by locale", () => {
    expect(() =>
      storefrontContext(
        new Store({
          currency: "EUR",
          locale: CommerceLocale.make("en-US"),
          storeKey: StoreKey.make("unknown"),
        }),
        configuration,
        stores
      )
    ).toThrow("not configured");
    expect(() =>
      storefrontContext(
        new Store({
          currency: "USD",
          locale: CommerceLocale.make("en-US"),
          storeKey: StoreKey.make("retail"),
        }),
        configuration,
        stores
      )
    ).toThrow("not configured");
  });

  it("requires exactly one native mapping for every Core Store and locale", () => {
    expect(() => {
      validateShopifyConfiguration(
        {
          ...configuration,
          stores: [...configuration.stores, ...configuration.stores],
        },
        stores
      );
    }).toThrow("Duplicate Shopify Store");
    expect(() => {
      validateShopifyConfiguration(
        { ...configuration, stores: configuration.stores.slice(1) },
        stores
      );
    }).toThrow("Missing Shopify Store mapping");
    expect(() => {
      validateShopifyConfiguration(configuration, stores.slice(1));
    }).toThrow("Exactly one default Store");
  });

  it("rejects a Market that disagrees with the Core Store's currency or configured buyer country", () => {
    expect(() => {
      validateShopifyConfiguration(
        configuration,
        stores.map((store) => ({ ...store, currency: "USD" }))
      );
    }).toThrow("declared country and currency");
    expect(() => {
      validateShopifyConfiguration(
        {
          ...configuration,
          stores: configuration.stores.map((store) => ({
            ...store,
            country: "US",
          })),
        },
        stores
      );
    }).toThrow("declared country and currency");
  });

  it("rejects ambiguous native Market identities and country membership", () => {
    expect(() => {
      validateShopifyConfiguration({
        ...shopifyConfiguration,
        markets: [
          ...shopifyConfiguration.markets,
          ...shopifyConfiguration.markets,
        ],
      });
    }).toThrow("keys and handles");
    expect(() => {
      validateShopifyConfiguration(
        {
          ...configuration,
          markets: configuration.markets.map((market) => ({
            ...market,
            countries: ["FR"],
          })),
        },
        stores
      );
    }).toThrow("not assigned to another Market");
  });
});
