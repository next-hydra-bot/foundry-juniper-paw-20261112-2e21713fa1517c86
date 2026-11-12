import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";

import { settingsFromEnvironment } from "../catalog/destination";
import { prepareTargets } from "./profile";

const environment = {
  SHOPIFY_ADMIN_CLIENT_ID: "test-client",
  SHOPIFY_ADMIN_CLIENT_SECRET: "test-secret",
  SHOPIFY_CATALOG_LOCATION_ID: "gid://shopify/Location/1",
  SHOPIFY_CATALOG_PUBLICATION_ID: "gid://shopify/Publication/1",
  SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
};

describe("Shopify setup credentials", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.effect(
    "exchanges client credentials lazily, caches and renews the Admin token",
    () =>
      Effect.gen(function* () {
        let acquisitions = 0;
        const authorization: string[] = [];
        const fetchApi = vi.fn<typeof fetch>(async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith("/admin/oauth/access_token")) {
            expect(
              new URLSearchParams(await request.text()).get("client_secret")
            ).toBe("test-secret");
            acquisitions += 1;
            return Response.json({
              access_token: `token-${acquisitions}`,
              expires_in: 120,
            });
          }
          authorization.push(
            request.headers.get("x-shopify-access-token") ?? ""
          );
          return Response.json({ data: { shop: { id: "shop" } } });
        });
        vi.stubGlobal("fetch", fetchApi);
        const targets = yield* prepareTargets(
          ConfigProvider.fromUnknown(environment)
        );
        expect(fetchApi).not.toHaveBeenCalled();
        yield* targets.admin.request("probe", "query { shop { id } }");
        yield* targets.admin.request("probe", "query { shop { id } }");
        expect(acquisitions).toBe(1);
        yield* TestClock.adjust("108 seconds");
        yield* targets.admin.request("probe", "query { shop { id } }");
        expect(acquisitions).toBe(2);
        expect(authorization).toEqual(["token-1", "token-1", "token-2"]);
      })
  );
  it.effect(
    "prepares a credential-free plan without any network requests",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetchApi);
        const { SHOPIFY_ADMIN_CLIENT_SECRET: _, ...publicEnvironment } =
          environment;
        const targets = yield* prepareTargets(
          ConfigProvider.fromUnknown(publicEnvironment)
        );
        expect(targets.target).toContain("test-client");
        expect(fetchApi).not.toHaveBeenCalled();
      })
  );
  it.effect(
    "supports a supplied Admin token and an explicit app identity without OAuth",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetchApi);
        const { SHOPIFY_ADMIN_CLIENT_SECRET: _, ...publicEnvironment } =
          environment;
        const targets = yield* prepareTargets(
          ConfigProvider.fromUnknown({
            ...publicEnvironment,
            SHOPIFY_ADMIN_ACCESS_TOKEN: "supplied-token",
          })
        );
        expect((yield* targets.settings).token).toBe("supplied-token");
        expect(fetchApi).not.toHaveBeenCalled();
      })
  );
  it.effect(
    "uses a supplied token when the app secret is also configured for signing",
    () =>
      Effect.gen(function* () {
        const fetchApi = vi.fn<typeof fetch>();
        vi.stubGlobal("fetch", fetchApi);
        const targets = yield* prepareTargets(
          ConfigProvider.fromUnknown({
            ...environment,
            SHOPIFY_ADMIN_ACCESS_TOKEN: "supplied-token",
          })
        );
        expect((yield* targets.settings).token).toBe("supplied-token");
        expect(fetchApi).not.toHaveBeenCalled();
      })
  );
  it.effect("uses the same token cache for standalone catalog settings", () =>
    Effect.gen(function* () {
      const fetchApi = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          access_token: "catalog-token",
          expires_in: 3600,
        })
      );
      vi.stubGlobal("fetch", fetchApi);
      const settings = yield* settingsFromEnvironment(environment);
      expect(fetchApi).not.toHaveBeenCalled();
      expect((yield* settings).token).toBe("catalog-token");
      expect((yield* settings).token).toBe("catalog-token");
      expect(fetchApi).toHaveBeenCalledOnce();
    })
  );
});
