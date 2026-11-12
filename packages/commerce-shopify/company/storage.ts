import "server-only";
import { Effect, Layer } from "effect";

import { ShopifyCompanyAdmin } from "./admin";
import { companyStorageLayerWith } from "./storage-core";

export const companyStorageLayer = (collection: string) =>
  Layer.unwrap(
    ShopifyCompanyAdmin.pipe(
      Effect.map((admin) => companyStorageLayerWith(collection, admin.request))
    )
  );
