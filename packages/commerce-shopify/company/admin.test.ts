/* oxlint-disable require-await -- Fetch test doubles return immediate native HTTP responses. */
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { ShopifyCompanyAdmin } from "./admin";

const environment = {
  SHOPIFY_ADMIN_CLIENT_ID: "client",
  SHOPIFY_ADMIN_CLIENT_SECRET: "secret",
  SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
};

describe(ShopifyCompanyAdmin, () => {
  it.effect(
    "uses an on-demand cached Admin token for runtime reads and writes",
    () => {
      let acquisitions = 0;
      const requests: { body: string; token: string | null }[] = [];
      const fetchApi: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/admin/oauth/access_token")) {
          acquisitions += 1;
          return Response.json({
            access_token: "runtime-token",
            expires_in: 3600,
          });
        }
        requests.push({
          body: await request.text(),
          token: request.headers.get("x-shopify-access-token"),
        });
        return Response.json({ data: { shop: { id: "shop-1" } } });
      };
      return Effect.gen(function* () {
        const admin = yield* ShopifyCompanyAdmin;
        expect(acquisitions).toBe(0);
        const first = yield* admin.request("query CurrentShop { shop { id } }");
        yield* admin.request(
          "mutation SaveRecord { metafieldsSet { userErrors { message } } }"
        );
        expect(first).toEqual({ shop: { id: "shop-1" } });
        expect(requests.map(({ token }) => token)).toEqual([
          "runtime-token",
          "runtime-token",
        ]);
        expect(acquisitions).toBe(1);
      }).pipe(
        Effect.provide(ShopifyCompanyAdmin.layerWith(environment, fetchApi))
      );
    }
  );

  it.effect(
    "invalidates a rejected credential and never replays the failed mutation",
    () => {
      let acquisitions = 0;
      const operations: string[] = [];
      const fetchApi: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.url.endsWith("/admin/oauth/access_token")) {
          acquisitions += 1;
          return Response.json({
            access_token: `token-${acquisitions}`,
            expires_in: 3600,
          });
        }
        operations.push(
          request.headers.get("x-shopify-access-token") ?? "missing"
        );
        return operations.length === 1
          ? new Response(null, { status: 401 })
          : Response.json({ data: { saved: true } });
      };
      return Effect.gen(function* () {
        const admin = yield* ShopifyCompanyAdmin;
        const failure = yield* admin
          .request(
            "mutation SaveRecord { metafieldsSet { userErrors { message } } }"
          )
          .pipe(Effect.flip);
        expect(failure._tag).toBe("CommerceAccountUnavailable");
        expect(operations).toEqual(["token-1"]);
        yield* admin.request("query CurrentShop { shop { id } }");
        expect(operations).toEqual(["token-1", "token-2"]);
        expect(acquisitions).toBe(2);
      }).pipe(
        Effect.provide(ShopifyCompanyAdmin.layerWith(environment, fetchApi))
      );
    }
  );

  it.effect(
    "does not send an Admin operation when token acquisition fails",
    () => {
      const urls: string[] = [];
      const fetchApi: typeof fetch = async (input, init) => {
        urls.push(new Request(input, init).url);
        return Response.json(
          { error: "secret provider detail" },
          { status: 401 }
        );
      };
      return Effect.gen(function* () {
        const admin = yield* ShopifyCompanyAdmin;
        const failure = yield* admin
          .request("query CurrentShop { shop { id } }")
          .pipe(Effect.flip);
        expect(failure._tag).toBe("CommerceAccountUnavailable");
        expect(urls).toEqual([
          "https://test.myshopify.com/admin/oauth/access_token",
        ]);
        expect(JSON.stringify(failure)).not.toContain("secret");
      }).pipe(
        Effect.provide(ShopifyCompanyAdmin.layerWith(environment, fetchApi))
      );
    }
  );
});
