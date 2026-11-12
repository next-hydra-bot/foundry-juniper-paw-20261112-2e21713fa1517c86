import { StoreKey } from "@repo/commerce-core/store";
import { Schema } from "effect";

/** Shared by the cart writer and the matching Order metafield definition. */
export const storeAttributionMetafield = {
  key: "store_key",
  namespace: "commerce",
  type: "single_line_text_field",
} as const;

export const ShopifyStoreAttribution = Schema.Struct({
  type: Schema.Literal(storeAttributionMetafield.type),
  value: StoreKey,
});
