import { describe, expect, it } from "vitest";

import { defaultContent } from "./default-content";
import {
  installedContentModel,
  jsonSchema,
  ContentProfile,
  richTextHtml,
} from "./model";
import { validateContentProfile, validateContentCategories } from "./profile";

describe("Portable CMS content", () => {
  const model = {
    ...installedContentModel(false),
    defaultLocale: "en-US",
    locales: ["en-US", "de-DE"] as const,
  };

  it("validates the portable editorial seed in multiple locales", () => {
    const profile = defaultContent({ ...model, locales: ["en-US", "de-DE"] });
    expect(validateContentProfile(profile, model).entries).toHaveLength(4);
    expect(jsonSchema(ContentProfile).$schema).toContain("2020-12");
  });

  it("rejects dangling links, duplicate routes and absent translations", () => {
    const profile = defaultContent(model);
    const missing = {
      ...profile,
      navigation: [
        {
          items: [{ link: { entryKey: "absent", label: "Missing" } }],
          key: "main",
          locale: "en-US",
        },
      ],
    };
    expect(() => validateContentProfile(missing, model)).toThrow(
      "Unknown entry reference"
    );
    const duplicate = {
      ...profile,
      entries: profile.entries.map((entry) => ({ ...entry, path: "/" })),
    };
    expect(() => validateContentProfile(duplicate, model)).toThrow("routes");
    const source = defaultContent({ ...model, locales: ["en-US", "de-DE"] });
    const translated = {
      ...source,
      entries: source.entries.filter(
        (entry) =>
          !(entry.key === "maintenance-guide" && entry.locale === "en-US")
      ),
    };
    expect(() => validateContentProfile(translated, model)).toThrow();
  });

  it("validates footer links and keeps the authored brand and copy", () => {
    const profile = defaultContent(model);
    const navigation = profile.navigation.map((menu) => ({
      ...menu,
      brandName: "North Coast",
      footerDescription: "Supplies for independent kitchens",
    }));
    const authored = validateContentProfile({ ...profile, navigation }, model);
    expect(authored.navigation).toEqual(navigation);

    const missing = navigation.map((menu) => ({
      ...menu,
      footerItems: [
        {
          children: [{ entryKey: "missing", label: "Contact" }],
          link: { entryKey: "home", label: "Home" },
        },
      ],
    }));
    expect(() =>
      validateContentProfile({ ...profile, navigation: missing }, model)
    ).toThrow("Unknown entry reference");
  });

  it("rejects a block the workspace cannot render", () => {
    const commercial = {
      ...installedContentModel(true),
      defaultLocale: model.defaultLocale,
      locales: model.locales,
    };
    const source = defaultContent(commercial);
    const profile = {
      ...source,
      entries: source.entries.map((entry) =>
        entry.type === "page"
          ? {
              ...entry,
              blocks: [
                {
                  categoryKey: "drinks",
                  key: "drinks",
                  limit: 3 as const,
                  title: "Drinks",
                  type: "product-collection" as const,
                },
              ],
            }
          : entry
      ),
    };
    expect(() => validateContentProfile(profile, model)).toThrow("absent");
    expect(() => {
      validateContentCategories(profile, []);
    }).toThrow("Unknown category source key");
    expect(() => {
      validateContentCategories(profile, ["drinks"]);
    }).not.toThrow();
  });

  it("escapes authored text while retaining semantic rich-text formatting", () => {
    expect(
      richTextHtml([
        {
          children: [{ marks: ["bold"], text: "Food & drink" }],
          level: 2,
          type: "heading",
        },
        {
          children: [{ text: '<script>alert("x")</script>' }],
          type: "paragraph",
        },
      ])
    ).toBe(
      "<h2><strong>Food &amp; drink</strong></h2><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>"
    );
  });
});
