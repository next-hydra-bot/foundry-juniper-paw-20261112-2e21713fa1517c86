import { createHash } from "node:crypto";

const identity = (id: string) => createHash("sha256").update(id).digest("hex");

export const catalogTags = {
  categories: "commerce:categories",
  product: (id: string) => `commerce:product:${identity(id)}`,
  productLists: "commerce:product-lists",
  productLookups: "commerce:product-lookups",
  products: "commerce:products",
} as const;

export type CatalogChange =
  | { readonly kind: "product"; readonly id: string }
  | { readonly kind: "category" }
  | { readonly kind: "catalog" };

/** List membership and negative lookups can change even when an entry did not contain this product. */
export const catalogChangeTags = (change: CatalogChange): readonly string[] =>
  change.kind === "product"
    ? [
        catalogTags.product(change.id),
        catalogTags.productLists,
        catalogTags.productLookups,
      ]
    : [
        catalogTags.products,
        catalogTags.categories,
        catalogTags.productLists,
        catalogTags.productLookups,
      ];
