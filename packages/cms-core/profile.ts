import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { Schema } from "effect";

import { ContentProfile } from "./model";
import type { ContentModel, ContentLink } from "./model";

export function entryIdentity(key: string, locale: string) {
  return `${key}/${locale}`;
}
function unique(values: readonly string[], label: string) {
  if (values.length !== new Set(values).size) {
    throw new Error(`${label} must be unique.`);
  }
}
export function validateContentProfile(
  input: unknown,
  installed: ContentModel
) {
  const profile = Schema.decodeUnknownSync(ContentProfile)(input, {
    onExcessProperty: "error",
  });
  const { model, assets, entries, navigation, announcements } = profile;
  unique(model.locales, "Locales");
  if (!model.locales.includes(model.defaultLocale)) {
    throw new Error("The default locale must be declared.");
  }
  const unsupported = model.locales.filter(
    (locale) => !installed.locales.includes(locale)
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Content locales are outside the workspace configuration: ${unsupported.join(", ")}.`
    );
  }
  if (
    model.entryTypes.some((type) => !installed.entryTypes.includes(type)) ||
    model.blockTypes.some((type) => !installed.blockTypes.includes(type))
  ) {
    throw new Error(
      "The content model uses a type or block absent from the installed CMS."
    );
  }
  unique(
    assets.map((asset) => asset.key),
    "Asset keys"
  );
  unique(
    entries.map((entry) => entryIdentity(entry.key, entry.locale)),
    "Entry key/locale pairs"
  );
  unique(
    entries.map((entry) => entryIdentity(entry.path, entry.locale)),
    "Entry routes"
  );
  unique(
    navigation.map((item) => entryIdentity(item.key, item.locale)),
    "Navigation key/locale pairs"
  );
  unique(
    announcements.map((item) => item.locale),
    "Announcement locales"
  );
  const assetKeys = new Set(assets.map((asset) => asset.key));
  const byIdentity = new Map(
    entries.map((entry) => [entryIdentity(entry.key, entry.locale), entry])
  );
  for (const item of [...entries, ...navigation, ...announcements]) {
    if (!model.locales.includes(item.locale)) {
      throw new Error(`Undeclared content locale: ${item.locale}`);
    }
  }
  const asset = (key: string | undefined, locale: string) => {
    if (
      key &&
      (!assetKeys.has(key) ||
        !Object.hasOwn(assets.find((asset) => asset.key === key)!.alt, locale))
    ) {
      throw new Error(`Missing asset or localized alt text: ${key}/${locale}`);
    }
  };
  const link = (value: ContentLink, locale: string, published: boolean) => {
    if ("entryKey" in value) {
      const target = byIdentity.get(entryIdentity(value.entryKey, locale));
      if (!target) {
        throw new Error(`Unknown entry reference: ${value.entryKey}/${locale}`);
      }
      if (published && !target.published) {
        throw new Error(
          `Published content links to an unpublished entry: ${value.entryKey}`
        );
      }
    }
  };
  for (const entry of entries) {
    const base = byIdentity.get(entryIdentity(entry.key, model.defaultLocale));
    if (!base || base.type !== entry.type) {
      throw new Error(
        `Every translation needs a default-locale entry of the same type: ${
          entry.key
        }`
      );
    }
    if (!model.entryTypes.includes(entry.type)) {
      throw new Error(`Undeclared entry type: ${entry.type}`);
    }
    if (entry.type === "article") {
      asset(entry.imageKey, entry.locale);
    } else {
      unique(
        entry.blocks.map((block) => block.key),
        `Block keys for ${entry.key}`
      );
      for (const block of entry.blocks) {
        if (!model.blockTypes.includes(block.type)) {
          throw new Error(`Undeclared block type: ${block.type}`);
        }
        if (block.type === "hero") {
          asset(block.imageKey, entry.locale);
          for (const target of block.links ?? []) {
            link(target, entry.locale, entry.published);
          }
        }
      }
    }
  }
  for (const menu of navigation) {
    for (const item of [...menu.items, ...(menu.footerItems ?? [])]) {
      link(item.link, menu.locale, true);
      for (const child of item.children ?? []) {
        link(child, menu.locale, true);
      }
    }
  }
  for (const announcement of announcements) {
    link(announcement.link, announcement.locale, announcement.enabled);
  }
  return profile;
}
export function loadContentProfile(directory: string, installed: ContentModel) {
  const read = (file: string) =>
    JSON.parse(readFileSync(resolve(directory, file), "utf-8"));
  const profile = validateContentProfile(
    {
      announcements: read("announcements.json"),
      assets: read("assets.json"),
      entries: read("entries.json"),
      model: read("content-model.json"),
      navigation: read("navigation.json"),
    },
    installed
  );
  for (const asset of profile.assets) {
    const file = assetPath(directory, asset.source);
    if (!/^https?:\/\//u.test(file) && !existsSync(file)) {
      throw new Error(`Missing content asset file: ${file}`);
    }
  }
  return profile;
}
export function contentCategoryKeys(profile: ContentProfile) {
  return [
    ...new Set(
      profile.entries.flatMap((entry) =>
        entry.type === "page"
          ? entry.blocks.flatMap((block) =>
              block.type === "product-collection" ? [block.categoryKey] : []
            )
          : []
      )
    ),
  ];
}
export function validateContentCategories(
  profile: ContentProfile,
  categoryKeys: readonly string[]
) {
  const keys = new Set(categoryKeys);
  for (const key of contentCategoryKeys(profile)) {
    if (!keys.has(key)) {
      throw new Error(`Unknown category source key: ${key}`);
    }
  }
}
export function linkPath(
  profile: ContentProfile,
  link: ContentLink,
  locale: string
) {
  return "url" in link
    ? link.url
    : profile.entries.find(
        (entry) => entry.key === link.entryKey && entry.locale === locale
      )!.path;
}
export function assetPath(directory: string, source: string) {
  return /^https?:\/\//u.test(source) ? source : resolve(directory, source);
}
