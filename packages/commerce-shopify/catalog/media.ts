import { createHash } from "node:crypto";
import path from "node:path";

import type { CatalogImage, CatalogProduct } from "@repo/commerce-core/catalog";

/** Stable provider-local filenames let Shopify reject duplicate creates. */
export const imageFilename = (
  product: Pick<CatalogProduct, "key">,
  image: CatalogImage
) => {
  const extension = path.posix.extname(new URL(image.url).pathname);
  if (!/^\.[a-z0-9]+$/iu.test(extension)) {
    throw new Error(
      "Shopify catalog images require a source URL with an explicit filename extension, for example /image.png."
    );
  }
  const hash = createHash("sha256")
    .update(image.url)
    .digest("hex")
    .slice(0, 20);
  return `catalog-${product.key}-${hash}${extension.toLowerCase()}`;
};
export const productImages = (product: {
  readonly variants: readonly Pick<
    CatalogProduct["variants"][number],
    "images"
  >[];
}) => [
  ...new Map(
    product.variants
      .flatMap(({ images }) => images)
      .map((image) => [image.url, image])
  ).values(),
];
