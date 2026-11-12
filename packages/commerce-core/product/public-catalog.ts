import type { PublicCatalogBinding } from "./public-catalog-runtime";

/** Provider recipes bind this module to their public, request-independent catalog. */
export const PublicCatalog: PublicCatalogBinding = {
  productCacheLife: "hours",
  run: () => {
    throw new Error("The public catalog provider is not configured");
  },
};
