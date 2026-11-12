import { createHash } from "node:crypto";

import type { RichText } from "@repo/cms-core";

export function richTextContentstack(body: RichText, namespace = "default") {
  const uid = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
  const content = `${namespace}:${JSON.stringify(body)}`;
  return {
    attrs: {},
    uid: uid(`doc:${content}`),
    children: body.length === 0 ? [{ attrs: {}, uid: uid(`block:0:${content}`), children: [{ text: "" }], type: "p" }] : body.map((block, index) => ({
      attrs: {},
      uid: uid(`block:${index}:${content}`),
      children: block.children.map((span) => ({
        text: span.text,
        ...(span.marks?.includes("bold") ? { bold: true } : {}),
        ...(span.marks?.includes("italic") ? { italic: true } : {}),
      })),
      type: block.type === "heading" ? `h${block.level ?? 2}` : "p",
    })),
    type: "doc",
  };
}
