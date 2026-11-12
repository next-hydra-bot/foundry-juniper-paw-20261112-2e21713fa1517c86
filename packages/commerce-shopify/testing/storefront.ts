import { Effect, Schema } from "effect";

import { ShopifyStorefrontClient } from "../client/storefront";
import type { ShopifyRequestFailure } from "../client/storefront";

const RequestBody = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);
export type ShopifyRequest = typeof RequestBody.Type;

/** Exercise the real Hydrogen client against an in-process Storefront API fixture. */
export const storefrontFixture = (
  respond: (
    request: ShopifyRequest
  ) => Effect.Effect<Schema.Json, ShopifyRequestFailure>
) =>
  ShopifyStorefrontClient.layerWith({
    environment: {
      SHOPIFY_BUYER_IP_HEADER: "x-vercel-forwarded-for",
      SHOPIFY_STOREFRONT_API_VERSION: "2026-10",
      SHOPIFY_STOREFRONT_PRIVATE_TOKEN: "private-test-token",
      SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
    },
    fetchApi: async (_input, init) => {
      const body = Schema.decodeUnknownSync(Schema.String)(init?.body);
      const request = Schema.decodeUnknownSync(RequestBody)(body);
      const data = await Effect.runPromise(respond(request));
      return new Response(
        Schema.encodeSync(Schema.fromJsonString(Schema.Json))({ data })
      );
    },
    requestHeaders: Effect.succeed(
      new Headers({ "x-vercel-forwarded-for": "192.0.2.1" })
    ),
  });
