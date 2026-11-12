import { localization } from "@repo/site-config";
import { Schema } from "effect";

export const ContentKey = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*$/u)
);
const text = Schema.NonEmptyString;
const path = Schema.String.check(Schema.isPattern(/^\/(?!\/)[^?#]*$/u));
export const ContentLink = Schema.Union([
  Schema.Struct({ entryKey: ContentKey, label: text }),
  Schema.Struct({
    label: text,
    url: Schema.String.check(
      Schema.isPattern(/^(?:https?:\/\/|\/(?!\/)|mailto:|tel:|#)/u)
    ),
  }),
]);
export type ContentLink = typeof ContentLink.Type;
export const RichText = Schema.Array(
  Schema.Struct({
    children: Schema.NonEmptyArray(
      Schema.Struct({
        marks: Schema.optionalKey(
          Schema.Array(Schema.Literals(["bold", "italic"]))
        ),
        text: Schema.String,
      })
    ),
    level: Schema.optionalKey(Schema.Literals([2, 3, 4])),
    type: Schema.Literals(["paragraph", "heading"]),
  })
);
export type RichText = typeof RichText.Type;
export const ContentAsset = Schema.Struct({
  alt: Schema.Record(Schema.String, Schema.String),
  key: ContentKey,
  source: text,
});
export type ContentAsset = typeof ContentAsset.Type;
export const ContentBlock = Schema.Union([
  Schema.Struct({
    body: Schema.optionalKey(RichText),
    imageKey: Schema.optionalKey(ContentKey),
    key: ContentKey,
    links: Schema.optionalKey(
      Schema.Array(ContentLink).check(Schema.isMaxLength(2))
    ),
    tagline: Schema.optionalKey(Schema.String),
    title: text,
    type: Schema.Literal("hero"),
  }),
  Schema.Struct({
    body: RichText,
    key: ContentKey,
    type: Schema.Literal("rich-text"),
  }),
  Schema.Struct({
    body: Schema.optionalKey(RichText),
    categoryKey: ContentKey,
    key: ContentKey,
    limit: Schema.Literals([3, 6, 9]),
    title: text,
    type: Schema.Literal("product-collection"),
  }),
]);
export type ContentBlock = typeof ContentBlock.Type;
const entryFields = {
  key: ContentKey,
  locale: text,
  path,
  published: Schema.Boolean,
  title: text,
};
export const ContentEntry = Schema.Union([
  Schema.Struct({
    ...entryFields,
    blocks: Schema.Array(ContentBlock),
    type: Schema.Literal("page"),
  }),
  Schema.Struct({
    ...entryFields,
    body: RichText,
    imageKey: Schema.optionalKey(ContentKey),
    summary: text,
    type: Schema.Literal("article"),
  }),
]);
export type ContentEntry = typeof ContentEntry.Type;

const navigationItem = Schema.Struct({
  children: Schema.optionalKey(Schema.Array(ContentLink)),
  link: ContentLink,
});
export const ContentNavigation = Schema.Struct({
  brandName: Schema.optionalKey(text),
  footerDescription: Schema.optionalKey(Schema.String),
  footerItems: Schema.optionalKey(Schema.Array(navigationItem)),
  items: Schema.Array(navigationItem),
  key: Schema.Literal("main"),
  locale: text,
});
export type ContentNavigation = typeof ContentNavigation.Type;
export const ContentAnnouncement = Schema.Struct({
  enabled: Schema.Boolean,
  key: ContentKey,
  link: ContentLink,
  locale: text,
  message: text,
});
export type ContentAnnouncement = typeof ContentAnnouncement.Type;
export const ContentModel = Schema.Struct({
  blockTypes: Schema.Array(
    Schema.Literals(["hero", "rich-text", "product-collection"])
  ),
  defaultLocale: text,
  entryTypes: Schema.NonEmptyArray(Schema.Literals(["page", "article"])),
  key: ContentKey,
  locales: Schema.NonEmptyArray(text),
  schemaVersion: Schema.Literal(1),
});
export type ContentModel = typeof ContentModel.Type;
export const ContentProfile = Schema.Struct({
  announcements: Schema.Array(ContentAnnouncement),
  assets: Schema.Array(ContentAsset),
  entries: Schema.Array(ContentEntry),
  model: ContentModel,
  navigation: Schema.Array(ContentNavigation),
});
export type ContentProfile = typeof ContentProfile.Type;
export const ContentResource = Schema.Struct({ id: text, key: text });
export type ContentResource = typeof ContentResource.Type;
export const ContentPage = ContentEntry.members[0];
export type ContentPage = typeof ContentPage.Type;
export const ContentArticle = ContentEntry.members[1];
export type ContentArticle = typeof ContentArticle.Type;
export interface ContentDependencies {
  readonly assets: Readonly<Record<string, string>>;
  readonly categories: Readonly<Record<string, string>>;
  /** Native entry identity resolved from the owning article/page definition. */
  readonly entry?: string;
}

export const installedContentModel = (commerce: boolean): ContentModel => ({
  blockTypes: commerce
    ? ["hero", "rich-text", "product-collection"]
    : ["hero", "rich-text"],
  defaultLocale: localization.defaultLocale,
  entryTypes: ["page", "article"],
  key: "site",
  locales: localization.locales,
  schemaVersion: 1,
});
export const contentSchemas = {
  announcements: Schema.Array(ContentAnnouncement),
  assets: Schema.Array(ContentAsset),
  entries: Schema.Array(ContentEntry),
  model: ContentModel,
  navigation: Schema.Array(ContentNavigation),
};
export function jsonSchema(schema: Schema.Top) {
  const doc = Schema.toJsonSchemaDocument(
    Schema.toEncoded(Schema.toCodecJson(schema)),
    { onExcessProperty: "error" }
  );
  return {
    $defs: doc.definitions,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...doc.schema,
  };
}
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function richTextHtml(body: RichText): string {
  return body
    .map((block) => {
      const tag = block.type === "heading" ? `h${block.level ?? 2}` : "p";
      const content = block.children
        .map((span) => {
          let value = escapeHtml(span.text);
          for (const mark of span.marks ?? []) {
            value =
              mark === "bold"
                ? `<strong>${value}</strong>`
                : `<em>${value}</em>`;
          }
          return value;
        })
        .join("");
      return `<${tag}>${content}</${tag}>`;
    })
    .join("");
}
/** Specialize generation to the selected model; decoding also checks relationships. */
export function profileSchema(model: ContentModel) {
  const blockNames = ["hero", "rich-text", "product-collection"] as const;
  const blocks = ContentBlock.members.filter((_schema, index) =>
    model.blockTypes.includes(blockNames[index]!)
  );
  const entries = [
    Schema.Struct({
      ...ContentEntry.members[0].fields,
      blocks: Schema.Array(Schema.Union(blocks)),
      locale: Schema.Literals(model.locales),
    }),
    Schema.Struct({
      ...ContentEntry.members[1].fields,
      locale: Schema.Literals(model.locales),
    }),
  ].filter((_schema, index) =>
    model.entryTypes.includes(index === 0 ? "page" : "article")
  );
  return Schema.Struct({
    ...ContentProfile.fields,
    entries: Schema.Array(Schema.Union(entries)),
  });
}
