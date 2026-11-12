import { invalidateCatalog } from "@repo/commerce-core/product/invalidation";
import { Config, Effect, Redacted, Schema } from "effect";

import { decodeShopifyCatalogEvent } from "./event";

const environment = Schema.Struct({
  SHOPIFY_CATALOG_WEBHOOK_SECRET: Schema.Redacted(Schema.NonEmptyString),
  SHOPIFY_STORE_DOMAIN: Schema.NonEmptyString,
});

export const handleCatalogEvent = async (
  request: Request
): Promise<Response> => {
  const status = await Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* Config.schema(environment);
      const body = yield* Effect.tryPromise(async () => await request.text());
      const decoded = decodeShopifyCatalogEvent(request.headers, body, {
        secret: Redacted.value(config.SHOPIFY_CATALOG_WEBHOOK_SECRET),
        shopDomain: config.SHOPIFY_STORE_DOMAIN,
      });
      const { change } = decoded;
      if (change) {
        yield* Effect.sync(() => {
          invalidateCatalog(change);
        });
      }
      return decoded.status;
    }).pipe(Effect.match({ onFailure: () => 503, onSuccess: (value) => value }))
  );
  return new Response(null, { status });
};
