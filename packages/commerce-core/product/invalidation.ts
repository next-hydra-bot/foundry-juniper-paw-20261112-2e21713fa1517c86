import "server-only";
import { revalidateTag } from "next/cache";

import { catalogChangeTags } from "./cache-tags";
import type { CatalogChange } from "./cache-tags";

export const invalidateCatalog = (change: CatalogChange): void => {
  for (const tag of catalogChangeTags(change)) {
    revalidateTag(tag, { expire: 0 });
  }
};
