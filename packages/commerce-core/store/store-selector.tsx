"use client";

import { RegionSelector } from "@repo/design-system/components/layout/region-selector";
import { hasLocale, useLocale } from "@repo/i18n";
import { locales } from "@repo/i18n/config";
import { getPathname, usePathname } from "@repo/i18n/navigation";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { storeConfiguration } from "./index";
import type { StoreConfiguration } from "./index";

/** Locale navigation selects the configured default Store for the destination locale. */
export const StoreSelector = ({
  configuration = storeConfiguration,
}: {
  readonly configuration?: StoreConfiguration;
}) => {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const stores = configuration.filter(({ isDefault }) => isDefault);

  return (
    <RegionSelector
      options={stores.map((store) => ({
        description: store.currency,
        id: store.locale,
        label: store.displayName ?? store.storeKey,
        shortLabel: store.displayCode ?? store.storeKey,
      }))}
      selectedId={locale}
      onSelect={(id) => {
        const selected = stores.find((store) => store.locale === id);
        if (selected && hasLocale(locales, selected.locale)) {
          router.push(
            getPathname({ href: pathname, locale: selected.locale }) as Route
          );
        }
      }}
    />
  );
};
