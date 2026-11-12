import { Effect, Layer, Schema } from "effect";
import { Tracking } from "migrate-sdk";

import { recordShopifyChange } from "../catalog/admin";
import type { CatalogAdmin } from "../catalog/admin";
import { companyStorageLayerWith } from "../company/storage-core";

const AcknowledgedWrite = Schema.Struct({ userErrors: Schema.Tuple([]) });

export const provisioningStorage = (
  collection: string,
  admin: CatalogAdmin<Tracking>
) =>
  Layer.unwrap(
    Tracking.pipe(
      Effect.map((tracking) =>
        companyStorageLayerWith(collection, (query, variables) =>
          admin
            .request(`provision ${collection}`, query, variables)
            .pipe(
              Effect.tap((data) =>
                Schema.is(AcknowledgedWrite)(data.metafieldsSet)
                  ? recordShopifyChange(
                      "metafieldsSet",
                      variables ?? {},
                      data.metafieldsSet
                    ).pipe(Effect.provideService(Tracking, tracking))
                  : Effect.void
              )
            )
        )
      )
    )
  );
