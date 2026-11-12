import { describe, expect, it } from "@effect/vitest";
import {
  LocalRuntimeEnvironmentPublicationReceipt,
  RuntimeEnvironmentPreflightError,
  RuntimeEnvironmentPublisher,
} from "@repo/cli-core/runtime-environment";
import type { RuntimeEnvironmentValues } from "@repo/cli-core/runtime-environment";
import { ConfigProvider, Effect, Redacted, Schema } from "effect";
import { afterEach, vi } from "vitest";

import {
  configureCustomerAccounts,
  customerAccountOrigin,
} from "./customer-accounts";

const config = ConfigProvider.fromUnknown({
  SHOPIFY_ADMIN_ACCESS_TOKEN: "admin-secret",
  SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
});
const fixture = (reject = false) => {
  const published: RuntimeEnvironmentValues[] = [];
  const fetchApi = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json({ data: { shop: { id: "gid://shopify/Shop/42" } } })
    );
  vi.stubGlobal("fetch", fetchApi);
  const layer = RuntimeEnvironmentPublisher.layerFrom({
    prepare: (input) =>
      reject
        ? Effect.fail(
            new RuntimeEnvironmentPreflightError({
              cause: undefined,
              destination: "local",
              message: "Output exists",
              operation: "conflicts",
            })
          )
        : Effect.succeed({
            destination: "local",
            manifest: input.manifest,
            path: "/private/customer.env",
          }),
    publish: (prepared, values) =>
      Effect.sync(() => {
        published.push(values);
        return new LocalRuntimeEnvironmentPublicationReceipt({
          destination: "local",
          mode: 0o600,
          path:
            prepared.destination === "local"
              ? prepared.path
              : "/private/customer.env",
        });
      }),
  });
  return { fetchApi, layer, published };
};
const options = {
  clientId: "headless-client",
  config,
  destination: {
    destination: "local" as const,
    output: "customer.env",
    publicationMode: "create" as const,
    yes: true,
  },
  origin: "https://web.shopify-b2c.localhost",
};

describe("Shopify customer-session configuration", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.effect(
    "generates a private session secret and maps the exact Headless client, storefront origin and Admin shop",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        const result = yield* configureCustomerAccounts(options).pipe(
          Effect.provide(target.layer)
        );
        expect(result.callback).toBe(`${options.origin}/account/authorize`);
        expect(result.logoutCallback).toBe(
          `${options.origin}/account/logout/complete`
        );
        expect(result.signOutContinuation).toBe(
          `${options.origin}/account/logout/continue`
        );
        const [values] = target.published;
        expect(values).toMatchObject({
          SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: "headless-client",
          SHOPIFY_SHOP_ID: "42",
          SHOPIFY_STOREFRONT_ORIGIN: options.origin,
        });
        const secret = values?.SHOPIFY_CUSTOMER_SESSION_SECRET;
        expect(Redacted.isRedacted(secret)).toBeTruthy();
        if (Redacted.isRedacted(secret)) {
          expect(Redacted.value(secret)).toHaveLength(43);
        }
        expect(values).not.toHaveProperty("SHOPIFY_ADMIN_CLIENT_ID");
        expect(
          yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
            result
          )
        ).not.toContain("admin-secret");
      })
  );
  it.effect("preserves a supplied session secret instead of rotating it", () =>
    Effect.gen(function* () {
      const target = fixture();
      const supplied = "existing-session-secret-that-is-long-enough";
      yield* configureCustomerAccounts({
        ...options,
        config: ConfigProvider.fromUnknown({
          SHOPIFY_ADMIN_ACCESS_TOKEN: "admin-secret",
          SHOPIFY_CUSTOMER_SESSION_SECRET: supplied,
          SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
        }),
      }).pipe(Effect.provide(target.layer));
      const value = target.published[0]?.SHOPIFY_CUSTOMER_SESSION_SECRET;
      if (!Redacted.isRedacted(value)) {
        throw new Error("Missing redacted session secret");
      }
      expect(Redacted.value(value)).toBe(supplied);
    })
  );
  it.effect("preflights the output before making any Shopify requests", () =>
    Effect.gen(function* () {
      const target = fixture(true);
      yield* configureCustomerAccounts(options).pipe(
        Effect.provide(target.layer),
        Effect.flip
      );
      expect(target.fetchApi).not.toHaveBeenCalled();
      expect(target.published).toEqual([]);
    })
  );
  it.effect(
    "rejects a configured shop ID that disagrees with the Admin store",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        const failure = yield* configureCustomerAccounts({
          ...options,
          config: ConfigProvider.fromUnknown({
            SHOPIFY_ADMIN_ACCESS_TOKEN: "admin-secret",
            SHOPIFY_SHOP_ID: "99",
            SHOPIFY_STORE_DOMAIN: "example.myshopify.com",
          }),
        }).pipe(Effect.provide(target.layer), Effect.flip);
        expect(failure.message).toContain("does not match");
        expect(target.published).toEqual([]);
      })
  );
  it.effect(
    "requires an HTTPS origin rather than a URL with an arbitrary path",
    () =>
      Effect.gen(function* () {
        expect(
          yield* customerAccountOrigin("http://web.storefront.localhost").pipe(
            Effect.isFailure
          )
        ).toBeTruthy();
        expect(
          yield* customerAccountOrigin("https://shop.example.com/other").pipe(
            Effect.isFailure
          )
        ).toBeTruthy();
      })
  );
});
