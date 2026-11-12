import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { catalogWebhookTopics, decodeShopifyCatalogEvent } from "./event";

const config = {
  secret: "app-client-secret",
  shopDomain: "example.myshopify.com",
};
const headers = (body: string, topic = "products/update") =>
  new Headers({
    "x-shopify-hmac-sha256": createHmac("sha256", config.secret)
      .update(body)
      .digest("base64"),
    "x-shopify-shop-domain": config.shopDomain,
    "x-shopify-topic": topic,
  });

describe("Shopify catalog events", () => {
  it("maps signed product create/update/delete payloads to the same native opaque ID as discovery", () => {
    const body = JSON.stringify({ id: 123 });
    for (const topic of [
      "products/create",
      "products/update",
      "products/delete",
    ]) {
      expect(
        decodeShopifyCatalogEvent(headers(body, topic), body, config)
      ).toEqual({
        change: { id: "gid://shopify/Product/123", kind: "product" },
        status: 202,
      });
    }
  });

  it("authenticates exact bytes and the expected shop before expiring data", () => {
    const body = '{"id":123}';
    expect(
      decodeShopifyCatalogEvent(headers(body), `${body} `, config).status
    ).toBe(401);
    expect(
      decodeShopifyCatalogEvent(headers(body), body, {
        ...config,
        shopDomain: "other.myshopify.com",
      }).status
    ).toBe(401);
    expect(decodeShopifyCatalogEvent(headers("{}"), "{}", config).status).toBe(
      400
    );
  });

  it("accepts every provisioned topic, including names containing underscores", () => {
    const body = '{"id":123}';
    for (const topic of Object.values(catalogWebhookTopics)) {
      expect(
        decodeShopifyCatalogEvent(headers(body, topic), body, config).status
      ).toBe(202);
    }
    expect(
      decodeShopifyCatalogEvent(
        headers(body, "inventory_levels/update"),
        body,
        config
      ).change
    ).toEqual({ kind: "catalog" });
    expect(
      decodeShopifyCatalogEvent(
        headers(body, "collections/update"),
        body,
        config
      ).change
    ).toEqual({ kind: "category" });
  });
});
