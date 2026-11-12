import { createHmac, timingSafeEqual } from "node:crypto";

import type { CatalogChange } from "@repo/commerce-core/product/cache-tags";
import { Schema } from "effect";

/** The CLI and receiver use the same supported topic set. */
export const catalogWebhookTopics = {
  COLLECTIONS_CREATE: "collections/create",
  COLLECTIONS_DELETE: "collections/delete",
  COLLECTIONS_UPDATE: "collections/update",
  INVENTORY_LEVELS_CONNECT: "inventory_levels/connect",
  INVENTORY_LEVELS_DISCONNECT: "inventory_levels/disconnect",
  INVENTORY_LEVELS_UPDATE: "inventory_levels/update",
  PRODUCTS_CREATE: "products/create",
  PRODUCTS_DELETE: "products/delete",
  PRODUCTS_UPDATE: "products/update",
  VARIANTS_IN_STOCK: "variants/in_stock",
  VARIANTS_OUT_OF_STOCK: "variants/out_of_stock",
} as const;

const ProductEvent = Schema.Struct({
  id: Schema.Union([
    Schema.NonEmptyString,
    Schema.Int.check(Schema.makeFilter(Number.isSafeInteger)),
  ]),
});

interface ShopifyCatalogEventResult {
  readonly status: number;
  readonly change?: CatalogChange;
}

export const decodeShopifyCatalogEvent = (
  headers: Headers,
  body: string,
  options: { readonly secret: string; readonly shopDomain: string }
): ShopifyCatalogEventResult => {
  const signature = headers.get("x-shopify-hmac-sha256");
  if (
    !signature ||
    headers.get("x-shopify-shop-domain") !== options.shopDomain
  ) {
    return { status: 401 };
  }
  const expected = createHmac("sha256", options.secret).update(body).digest();
  const actual = Buffer.from(signature, "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { status: 401 };
  }
  const topic = headers.get("x-shopify-topic") ?? "";
  const supported = Object.values(catalogWebhookTopics).some(
    (value) => value === topic
  );
  if (!supported) {
    return { status: 204 };
  }
  if (topic.startsWith("products/")) {
    const decoded = Schema.decodeOption(Schema.fromJsonString(ProductEvent))(
      body
    );
    if (
      decoded._tag === "None" ||
      !/^[1-9]\d*$/u.test(String(decoded.value.id))
    ) {
      return { status: 400 };
    }
    return {
      change: {
        id: `gid://shopify/Product/${decoded.value.id}`,
        kind: "product",
      },
      status: 202,
    };
  }
  // Inventory events do not carry a product ID. Expire all dependent public reads.
  const decoded = Schema.decodeOption(
    Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
  )(body);
  if (decoded._tag === "None") {
    return { status: 400 };
  }
  return {
    change: { kind: topic.startsWith("collections/") ? "category" : "catalog" },
    status: 202,
  };
};
