/* oxlint-disable require-await -- Fetch test doubles return or reject immediate native HTTP responses. */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { ShopifyAdminAccessToken } from "./access-token";
import type { ShopifyAdminEnvironment } from "./keys";

const environment = {
  SHOPIFY_ADMIN_CLIENT_ID: "test-client",
  SHOPIFY_ADMIN_CLIENT_SECRET: "test-secret",
  SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
};
const fixture = (lifetime = 120) => {
  const calls: {
    body: string;
    domain: string;
    cache: RequestCache | undefined;
    redirect: RequestRedirect | undefined;
  }[] = [];
  let failure = false;
  const fetchApi: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    calls.push({
      body: await request.text(),
      cache: init?.cache,
      domain: request.url,
      redirect: init?.redirect,
    });
    return failure
      ? Response.json(
          { error: "test-secret private provider diagnostic" },
          { status: 401 }
        )
      : Response.json({
          access_token: `token-${calls.length}`,
          expires_in: lifetime,
          scope: "read_products",
        });
  };
  return {
    calls,
    fetchApi,
    layer: ShopifyAdminAccessToken.layerWith(environment, fetchApi),
    reject: (value: boolean) => {
      failure = value;
    },
  };
};

const makeFetch =
  (prefix: string): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const body = new URLSearchParams(await request.text());
    return Response.json({
      access_token: `${prefix}/${new URL(request.url).hostname}/${body.get("client_id")}`,
      expires_in: 3600,
    });
  };

describe(ShopifyAdminAccessToken, () => {
  it.effect(
    "acquires lazily, sends the client credentials grant and reuses the cached token",
    () => {
      const target = fixture();
      return Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        expect(target.calls).toHaveLength(0);
        const first = yield* credentials.get;
        const second = yield* credentials.get;
        expect([Redacted.value(first), Redacted.value(second)]).toEqual([
          "token-1",
          "token-1",
        ]);
        expect(target.calls).toEqual([
          {
            body: "client_id=test-client&client_secret=test-secret&grant_type=client_credentials",
            cache: "no-store",
            domain: "https://test.myshopify.com/admin/oauth/access_token",
            redirect: "error",
          },
        ]);
        expect(JSON.stringify(first)).not.toContain("token-1");
      }).pipe(Effect.provide(target.layer));
    }
  );

  it.effect("shares one acquisition across simultaneous callers", () => {
    const target = fixture();
    return Effect.gen(function* () {
      const credentials = yield* ShopifyAdminAccessToken;
      const tokens = yield* Effect.all(
        Array.from({ length: 20 }, () => credentials.get),
        { concurrency: "unbounded" }
      );
      expect(tokens.map(Redacted.value)).toEqual(
        Array.from({ length: 20 }, () => "token-1")
      );
      expect(target.calls).toHaveLength(1);
    }).pipe(Effect.provide(target.layer));
  });

  it.effect("uses Shopify's lifetime and renews before expiry", () => {
    const target = fixture();
    return Effect.gen(function* () {
      const credentials = yield* ShopifyAdminAccessToken;
      const first = yield* credentials.get;
      yield* TestClock.adjust("107 seconds");
      const cached = yield* credentials.get;
      yield* TestClock.adjust("1 second");
      const renewed = yield* credentials.get;
      expect([first, cached, renewed].map(Redacted.value)).toEqual([
        "token-1",
        "token-1",
        "token-2",
      ]);
      expect(target.calls).toHaveLength(2);
    }).pipe(Effect.provide(target.layer));
  });

  it.effect(
    "discards a rejected token without discarding a newer replacement",
    () => {
      const target = fixture();
      return Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        const original = yield* credentials.get;
        yield* credentials.invalidate(original);
        const replacement = yield* credentials.get;
        yield* credentials.invalidate(original);
        expect(Redacted.value(yield* credentials.get)).toBe(
          Redacted.value(replacement)
        );
        expect(target.calls).toHaveLength(2);
      }).pipe(Effect.provide(target.layer));
    }
  );

  it.effect(
    "does not cache failed acquisition or expose provider diagnostics",
    () => {
      const target = fixture();
      target.reject(true);
      return Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        const error = yield* credentials.get.pipe(Effect.flip);
        expect(error._tag).toBe("CommerceAccountUnavailable");
        expect(JSON.stringify(error)).not.toContain("test-secret");
        target.reject(false);
        expect(Redacted.value(yield* credentials.get)).toBe("token-2");
      }).pipe(Effect.provide(target.layer));
    }
  );

  it.effect(
    "keeps different shops, apps and injected transports separate",
    () => {
      const first = ShopifyAdminAccessToken.layerWith(
        environment,
        makeFetch("first")
      );
      const otherApp = ShopifyAdminAccessToken.layerWith(
        { ...environment, SHOPIFY_ADMIN_CLIENT_ID: "other-client" },
        makeFetch("second")
      );
      const otherShop = ShopifyAdminAccessToken.layerWith(
        { ...environment, SHOPIFY_STORE_DOMAIN: "other.myshopify.com" },
        makeFetch("third")
      );
      return Effect.gen(function* () {
        const read = ShopifyAdminAccessToken.pipe(
          Effect.flatMap((credentials) => credentials.get)
        );
        const tokens = yield* Effect.all(
          [
            read.pipe(Effect.provide(first)),
            read.pipe(Effect.provide(otherApp)),
            read.pipe(Effect.provide(otherShop)),
          ],
          { concurrency: "unbounded" }
        );
        expect(tokens.map(Redacted.value)).toEqual([
          "first/test.myshopify.com/test-client",
          "second/test.myshopify.com/other-client",
          "third/other.myshopify.com/test-client",
        ]);
      });
    }
  );

  it.effect(
    "supports an explicitly supplied token without calling OAuth",
    () => {
      const layer = ShopifyAdminAccessToken.layerWith(
        {
          SHOPIFY_ADMIN_ACCESS_TOKEN: "supplied",
          SHOPIFY_STORE_DOMAIN: environment.SHOPIFY_STORE_DOMAIN,
        },
        async () => {
          throw new Error("Unexpected HTTP request");
        }
      );
      return Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        const token = yield* credentials.get;
        yield* credentials.invalidate(token);
        expect(Redacted.value(yield* credentials.get)).toBe("supplied");
      }).pipe(Effect.provide(layer));
    }
  );

  it.each([
    { access_token: "secret-response", expires_in: 0 },
    { access_token: "secret-response", expires_in: -1 },
    { access_token: "secret-response", expires_in: 1.5 },
    { access_token: "", expires_in: 3600 },
    { access_token: "secret-response" },
  ])(
    "rejects invalid token responses without exposing their contents: %j",
    async (response) => {
      const error = await Effect.runPromise(
        ShopifyAdminAccessToken.pipe(
          Effect.flatMap((credentials) => credentials.get),
          Effect.flip,
          Effect.provide(
            ShopifyAdminAccessToken.layerWith(environment, async () =>
              Response.json(response)
            )
          )
        )
      );
      expect(error._tag).toBe("CommerceAccountUnavailable");
      expect(JSON.stringify(error)).not.toContain("secret-response");
    }
  );

  it.each([
    { SHOPIFY_STORE_DOMAIN: "test.myshopify.com" },
    {
      SHOPIFY_ADMIN_CLIENT_ID: "client",
      SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
    },
    { ...environment, SHOPIFY_ADMIN_ACCESS_TOKEN: "secret-config" },
    { ...environment, SHOPIFY_STORE_DOMAIN: "attacker.example.com" },
  ])(
    "rejects missing, mixed or unsafe credential configuration: %j",
    async (config: ShopifyAdminEnvironment) => {
      const exit = await Effect.runPromise(
        ShopifyAdminAccessToken.pipe(
          Effect.provide(ShopifyAdminAccessToken.layerWith(config)),
          Effect.exit
        )
      );
      expect(exit._tag).toBe("Failure");
      expect(String(exit)).not.toContain("secret-config");
    }
  );

  it.effect(
    "times out and aborts acquisition without retaining the failure",
    () => {
      const signals: AbortSignal[] = [];
      const fetchApi: typeof fetch = async (_input, init) =>
        // oxlint-disable-next-line promise/avoid-new -- A controlled fetch promise exposes native AbortSignal cancellation at the transport seam.
        await new Promise<Response>((_resolve, reject) => {
          if (init?.signal) {
            const { signal } = init;
            signals.push(signal);
            signal.addEventListener(
              "abort",
              () => {
                reject(new Error("Aborted"));
              },
              { once: true }
            );
          }
        });
      return Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        const pending = yield* credentials.get.pipe(Effect.forkChild);
        yield* TestClock.adjust("30 seconds");
        const error = yield* Fiber.join(pending).pipe(Effect.flip);
        expect(error._tag).toBe("CommerceAccountUnavailable");
        expect(signals[0]?.aborted).toBeTruthy();
      }).pipe(
        Effect.provide(
          ShopifyAdminAccessToken.layerWith(environment, fetchApi)
        ),
        Effect.scoped
      );
    }
  );
});
