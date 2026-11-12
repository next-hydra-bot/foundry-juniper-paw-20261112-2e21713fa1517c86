import { makePublicCatalogRuntime } from "@repo/commerce-core/product/public-catalog-runtime";
import { Effect, Layer } from "effect";

import { ShopifyStorefrontClient } from "../client/storefront";
import { keys } from "../keys";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This provider binding composes the public catalog runtime.
import { productDiscoveryLayer } from "./index";

export const PublicCatalog = makePublicCatalogRuntime(
  productDiscoveryLayer.pipe(
    Layer.provide(
      Layer.suspend(() =>
        ShopifyStorefrontClient.layerWith({
          environment: keys(),
          requestHeaders: Effect.succeed(new Headers({ "x-request-id": "" })),
          requireBuyerIp: false,
        })
      )
    )
  )
);
