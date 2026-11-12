import { installedContentModel } from "@repo/cms-core";
import { defaultContent } from "@repo/cms-core/default-content";
import { describe, expect, it } from "vitest";
import { Option } from "effect";

import { decodeCommerceCategoryId } from "../lib/commerce-category";

import { contentstackBlocks } from "./destination";
import { richTextContentstack } from "./rich-text";

describe("Contentstack portable blocks", () => {
  it("maps links to native entry references, rich text and commerce IDs", () => {
    const profile = defaultContent(installedContentModel(true));
    const page = profile.entries.find((entry) => entry.type === "page")!;
    if (page.type !== "page") {
      throw new Error("Expected page");
    }
    const blocks = contentstackBlocks(
      {
        ...page,
        blocks: [
          ...page.blocks,
          {
            body: [
              { children: [{ text: "Wholesale supplies" }], type: "paragraph" },
            ],
            key: "copy",
            type: "rich-text",
          },
          {
            categoryKey: "drinks",
            key: "drinks",
            limit: 3,
            title: "Drinks",
            type: "product-collection",
          },
        ],
      },
      profile,
      { assets: {}, categories: { drinks: "native-category" } }
    );
    const collection = blocks.find((block) => "dynamic_product_collection" in block);
    if (!collection?.dynamic_product_collection) {
      throw new Error("Expected product collection");
    }
    expect(Option.getOrUndefined(decodeCommerceCategoryId(
      collection.dynamic_product_collection.product_category
    ))).toBe("native-category");
    expect(blocks).toMatchObject([
      {
        hero_section: {
          cta: [
            { external_url: "/resources/preventive-maintenance-checklist" },
          ],
        },
      },
      {
        rich_text: {
          body: {
            children: [
              { children: [{ text: "Wholesale supplies" }], type: "p" },
            ],
            type: "doc",
          },
        },
      },
      {
        dynamic_product_collection: {
          product_category: "native-category",
        },
      },
    ]);
  });
});

describe("Localized modular-block contract", () => {
  it("preserves the master UID on repeated updates", async () => {
    const { localizedBlockMetadata } = await import("./localized-blocks");
    const fromMaster = { uid: "master-product-block" };
    expect(
      localizedBlockMetadata(fromMaster, {
        key: "drinks",
        type: "product-collection",
        categoryKey: "drinks",
        title: "Drinks",
        limit: 3,
      })
    ).toEqual({
      uid: "master-product-block",
    });
    expect(
      localizedBlockMetadata(fromMaster, {
        key: "hero",
        type: "hero",
        title: "Welcome",
      })
    ).toEqual({
      uid: "master-product-block",
    });
  });
});


it("emits stable Contentstack JSON RTE document and block UIDs", () => {
  const body = [{ type: "paragraph" as const, children: [{ text: "Care" }] }];
  const result = richTextContentstack(body);
  expect(result).toEqual(richTextContentstack(body));
  expect(result.uid).toMatch(/^[a-f0-9]{16}$/);
  expect(result.children[0]?.uid).toMatch(/^[a-f0-9]{16}$/);
  expect(result.children[0]?.children).toEqual([{ text: "Care" }]);
});


it("emits a structured empty paragraph for empty rich text", () => {
  expect(richTextContentstack([]).children).toMatchObject([
    { type: "p", attrs: {}, children: [{ text: "" }] },
  ]);
});


it("uses distinct stable UIDs for identical rich text in different blocks", () => {
  expect(richTextContentstack([], "dog").uid).not.toBe(
    richTextContentstack([], "cat").uid
  );
});
