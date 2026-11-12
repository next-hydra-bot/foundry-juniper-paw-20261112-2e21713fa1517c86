"use client";

import { useLocale } from "@repo/i18n";
import { locales } from "@repo/i18n/config";
import { getPathname, usePathname } from "@repo/i18n/navigation";
import type { Route } from "next";
import { useRouter } from "next/navigation";

import { RegionSelector } from "./region-selector";

/** Language navigation for sites without Commerce. */
export const LocaleSelector = () => {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const names = new Intl.DisplayNames([locale], { type: "language" });

  return (
    <RegionSelector
      label="Current language"
      options={locales.map((value) => ({
        id: value,
        label: names.of(value) ?? value,
        shortLabel: value,
      }))}
      selectedId={locale}
      onSelect={(id) => {
        const selected = locales.find((value) => value === id);
        if (selected) {
          router.push(
            getPathname({ href: pathname, locale: selected }) as Route
          );
        }
      }}
    />
  );
};
