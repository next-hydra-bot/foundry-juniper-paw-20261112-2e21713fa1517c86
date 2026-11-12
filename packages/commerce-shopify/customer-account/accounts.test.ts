/* oxlint-disable vitest/max-expects -- These protocol tests assert complete authentication and refresh exchanges. */
import { describe, expect, it } from "@effect/vitest";
import { NextRequestApi } from "@repo/actions/next-request";
import type { NextCookieStore } from "@repo/actions/next-request";
import { AuthSession, AuthSessionAdapter } from "@repo/auth-contract/session";
import {
  LineItemId,
  PositiveCartQuantity,
} from "@repo/commerce-core/domain/cart";
import {
  B2CPurchasingContextRequest,
  AuthUserId,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import {
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { afterEach, vi } from "vitest";

import type { ShopifyCart } from "../cart/schema";
import { ShopifyCartSession, CART_COOKIE_NAME } from "../cart/session";
import { checkoutDestination } from "../checkout/programs";
import { ShopifyRequestFailure } from "../client/storefront";
import { storefrontFixture } from "../testing/storefront";
import { safeReturnTo, ShopifyCustomerAccounts } from "./accounts";
import { authenticatedCartStorageLayer } from "./cart";
import { b2cPurchasingContextLayer } from "./commerce-context";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const origin = "https://store.example";
const environment = {
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: "public-client",
  SHOPIFY_CUSTOMER_SESSION_SECRET:
    "test-session-secret-at-least-thirty-two-characters",
  SHOPIFY_SHOP_ID: "123",
  SHOPIFY_STOREFRONT_ORIGIN: origin,
};
const fixture = () => {
  const values = new Map<string, string>();
  let userId = "user-1";
  let sessionId = "session-1";
  let customerEmail = "buyer@example.com";
  let customerFirstName = "Buyer";
  let nonce = "";
  let tokenRequests = 0;
  let refreshStatus = 200;
  let profileStatus = 200;
  const cookies = {
    delete: (name: string) => {
      values.delete(name);
    },
    get: (name: string) =>
      values.has(name) ? { value: values.get(name) ?? "" } : undefined,
    set: (name: string, value: string) => {
      values.set(name, value);
    },
  };
  let currentCookies: NextCookieStore = cookies;
  const fetchApi: typeof globalThis.fetch = async (input, options) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    if (url.pathname.endsWith("/oauth/token")) {
      tokenRequests += 1;
      const body = new URLSearchParams(
        await new Response(options?.body).text()
      );
      if (body.get("grant_type") === "refresh_token" && refreshStatus !== 200) {
        return Response.json(
          { error: "invalid_grant" },
          { status: refreshStatus }
        );
      }
      const claims = {
        aud: "public-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: "https://shopify.com/authentication/123",
        nonce,
        sub: "customer-1",
      };
      return Response.json({
        access_token: `customer-token-${tokenRequests}`,
        expires_in: 300,
        id_token: `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`,
        refresh_token: "refresh-token",
      });
    }
    if (url.pathname.endsWith("/graphql")) {
      if (profileStatus !== 200) {
        return Response.json(
          { errors: [{ message: "Unauthenticated" }] },
          { status: profileStatus }
        );
      }
      return Response.json({
        data: {
          customer: {
            emailAddress: { emailAddress: customerEmail },
            firstName: customerFirstName,
            id: "gid://shopify/Customer/1",
            lastName: null,
          },
        },
      });
    }
    throw new Error("Unexpected Shopify request");
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(AuthSessionAdapter, {
      read: Effect.sync(
        () =>
          new AuthSession({
            permissions: { has: () => false },
            sessionId,
            user: userId
              ? {
                  email: "buyer@example.com",
                  firstName: "Buyer",
                  id: userId,
                  lastName: null,
                  profilePictureUrl: null,
                }
              : null,
          })
      ),
    }),
    Layer.succeed(NextRequestApi, {
      connect: () => Effect.void,
      getCookies: () => Effect.sync(() => currentCookies),
      getLocale: () => Effect.succeed("en-US"),
    })
  );
  const runtime = ManagedRuntime.make(
    ShopifyCustomerAccounts.layerWith({
      environment,
      fetchApi,
      identityStoreLayer: VersionedKeyValueStore.layerMemory,
    }).pipe(Layer.provideMerge(dependencies))
  );
  const handle = async (path: string) =>
    await runtime.runPromise(
      ShopifyCustomerAccounts.pipe(
        Effect.flatMap((accounts) =>
          accounts.handle(new Request(`${origin}${path}`))
        )
      )
    );
  const read = async () =>
    await runtime.runPromise(
      ShopifyCustomerAccounts.pipe(Effect.flatMap((accounts) => accounts.read))
    );
  const logout = async (headers?: HeadersInit) =>
    await runtime.runPromise(
      ShopifyCustomerAccounts.pipe(
        Effect.flatMap((accounts) =>
          accounts.handle(
            new Request(`${origin}/account/logout`, {
              headers: headers ?? { origin },
              method: "POST",
            })
          )
        )
      )
    );
  const login = async (path = "/account/login?return_to=/en-US/checkout") => {
    const result = await handle(path);
    const url = new URL(result.destination);
    nonce = url.searchParams.get("nonce") ?? "";
    return url;
  };
  const authorize = async (state: string) =>
    await handle(`/account/authorize?code=authorization-code&state=${state}`);
  return {
    authorize,
    handle,
    login,
    logout,
    read,
    requests: () => tokenRequests,
    runtime,
    setCookieStore: (store: NextCookieStore) => {
      currentCookies = store;
    },
    setCustomerEmail: (email: string) => {
      customerEmail = email;
    },
    setCustomerFirstName: (name: string) => {
      customerFirstName = name;
    },
    setProfileStatus: (status: number) => {
      profileStatus = status;
    },
    setRefreshStatus: (status: number) => {
      refreshStatus = status;
    },
    setSession: (id: string) => {
      sessionId = id;
    },
    setUser: (id: string) => {
      userId = id;
    },
    values,
  };
};

const customerCartFixture = () => {
  const f = fixture();
  const store = resolveStore(
    { locale: CommerceLocale.make("en-US") },
    storeConfiguration
  );
  const privateId = "gid://shopify/Cart/guest?key=private-guest-cart";
  f.values.set(
    CART_COOKIE_NAME,
    JSON.stringify({
      id: privateId,
      locale: store.locale,
      shop: "example.myshopify.com",
      storeKey: store.storeKey,
    })
  );
  let outcome: "success" | "rejected" | "responseLost" = "success";
  let customerId: string | null = null;
  let attachedToken: string | undefined;
  let attempts = 0;
  let quantity = 1;
  let lineWrites = 0;
  const cart = (): ShopifyCart => ({
    buyerIdentity: {
      countryCode: "US",
      customer: customerId ? { id: customerId } : null,
      purchasingCompany: null,
    },
    checkoutUrl: "https://example.myshopify.com/checkouts/customer",
    cost: { totalAmount: { amount: "12.00", currencyCode: "USD" } },
    discountApplications: [],
    discountCodes: [],
    id: privateId,
    lines: {
      nodes: [
        {
          cost: {
            amountPerQuantity: { amount: "12.00", currencyCode: "USD" },
            compareAtAmountPerQuantity: null,
            subtotalAmount: { amount: "12.00", currencyCode: "USD" },
            totalAmount: { amount: "12.00", currencyCode: "USD" },
          },
          discountAllocations: [],
          id: "line-1",
          merchandise: {
            id: "variant-1",
            image: null,
            product: { id: "product-1", title: "Example" },
            selectedOptions: [
              { name: "Size", value: "M" },
              { name: "Color", value: "Blue" },
            ],
            sku: null,
          },
          quantity,
        },
      ],
      pageInfo: { endCursor: null, hasNextPage: false },
    },
    storeAttribution: { type: "single_line_text_field", value: store.storeKey },
    totalQuantity: quantity,
  });
  const client = storefrontFixture((request) =>
    Effect.gen(function* () {
      if (request.query.includes("cartLinesUpdate(")) {
        expect(request.variables).toMatchObject({
          lines: [{ id: "line-1", quantity: 2 }],
        });
        lineWrites += 1;
        quantity = 2;
        return Schema.decodeSync(Schema.Json)({
          cartLinesUpdate: { cart: cart(), userErrors: [], warnings: [] },
        });
      }
      if (request.query.includes("cartBuyerIdentityUpdate(")) {
        attempts += 1;
        if (outcome !== "rejected") {
          const identity = Schema.decodeUnknownSync(
            Schema.Struct({ customerAccessToken: Schema.NullOr(Schema.String) })
          )(request.variables.buyerIdentity);
          customerId = identity.customerAccessToken
            ? "gid://shopify/Customer/1"
            : null;
          attachedToken = identity.customerAccessToken ?? undefined;
        }
        if (outcome !== "success") {
          return yield* new ShopifyRequestFailure({ reason: "unavailable" });
        }
        return Schema.decodeUnknownSync(Schema.Json)({
          cartBuyerIdentityUpdate: {
            cart: cart(),
            userErrors: [],
            warnings: [],
          },
        });
      }
      return Schema.decodeUnknownSync(Schema.Json)({ cart: cart() });
    })
  );
  const context = b2cPurchasingContextLayer(
    new B2CPurchasingContextRequest({
      authUserId: AuthUserId.make("user-1"),
      store,
    })
  );
  const services = Layer.merge(
    authenticatedCartStorageLayer,
    CurrentCart.layerFromStorage.pipe(
      Layer.provide(authenticatedCartStorageLayer)
    )
  ).pipe(
    Layer.provideMerge(context),
    Layer.provideMerge(client),
    Layer.provideMerge(CartPolicies.layerEmpty)
  );
  return {
    ...f,
    attachedToken: () => attachedToken,
    attempts: () => attempts,
    changeQuantity: async () =>
      await f.runtime.runPromise(
        CurrentCart.setLineItemQuantity({
          lineItemId: LineItemId.make("line-1"),
          quantity: PositiveCartQuantity.make(2),
        }).pipe(Effect.provide(services), Effect.result)
      ),
    checkout: async () =>
      await f.runtime.runPromise(
        checkoutDestination.pipe(Effect.provide(services))
      ),
    destination: async () =>
      await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.checkoutDestination("/en-US/checkout")
          )
        )
      ),
    detachBuyer: async () => {
      await f.runtime.runPromise(
        ShopifyCartSession.pipe(
          Effect.flatMap((session) => session.detachBuyer()),
          Effect.provide(services)
        )
      );
    },
    lineWrites: () => lineWrites,
    readCart: async () =>
      await f.runtime.runPromise(
        CurrentCart.get().pipe(Effect.provide(services))
      ),
    setOutcome: (value: typeof outcome) => {
      outcome = value;
    },
    setRemoteCustomer: (value: string) => {
      customerId = value;
    },
    synchronize: async () =>
      await f.runtime.runPromise(
        ShopifyCartSession.pipe(
          Effect.flatMap((session) => session.synchronizeBuyer()),
          Effect.provide(services),
          Effect.result
        )
      ),
  };
};

describe("Customer account authentication", () => {
  afterEach(() => vi.useRealTimers());

  it("opens order history without attaching a cart and retains the checkout attachment requirement", async () => {
    const f = fixture();
    try {
      const history = "/en-US/account/orders?store=default-store&after=page-2";
      const destination = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.accountDestination(history))
        )
      );
      expect(destination).toBeDefined();
      const login = await f.login(destination);
      const callback = await f.authorize(login.searchParams.get("state") ?? "");
      expect(callback).toEqual({
        destination: history,
        synchronizeCart: false,
      });
      const identity = await f.read();
      expect(identity?.cartSynchronizationPending).toBeTruthy();
      await expect(
        f.runtime.runPromise(
          ShopifyCustomerAccounts.pipe(
            Effect.flatMap((accounts) => accounts.accountDestination(history))
          )
        )
      ).resolves.toBeUndefined();
      await expect(
        f.runtime.runPromise(
          ShopifyCustomerAccounts.pipe(
            Effect.flatMap((accounts) =>
              accounts.checkoutDestination("/en-US/checkout")
            )
          )
        )
      ).resolves.toContain("/account/refresh?");
    } finally {
      await f.runtime.dispose();
    }
  });

  it("refreshes an account session without requiring cart or discovery services", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    try {
      const login = await f.login(
        "/account/login?purpose=account&return_to=/en-US/account/orders"
      );
      await f.authorize(login.searchParams.get("state") ?? "");
      vi.setSystemTime(Date.now() + 301_000);
      const destination = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.accountDestination("/en-US/account/orders")
          )
        )
      );
      expect(destination).toContain("/account/refresh?");
      expect(destination).toContain("purpose=account");
      if (!destination) {
        throw new Error("Account refresh destination is required");
      }
      const callback = await f.handle(destination);
      expect(callback).toEqual({
        destination: "/en-US/account/orders",
        synchronizeCart: false,
      });
      const identity = await f.read();
      expect(identity?.accessToken).toBeDefined();
      expect(identity?.cartSynchronizationPending).toBeTruthy();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("preserves the account purpose through mismatched native identity recovery", async () => {
    const f = fixture();
    try {
      const history = "/en-US/account/orders/order-1";
      const login = await f.login(
        `/account/login?purpose=account&return_to=${encodeURIComponent(history)}`
      );
      f.setCustomerEmail("other@example.com");
      await f.authorize(login.searchParams.get("state") ?? "");
      const reset = await f.handle("/account/logout/complete");
      expect(reset.destination).toContain("purpose=account");
      const retry = await f.login(reset.destination);
      f.setCustomerEmail("buyer@example.com");
      await expect(
        f.authorize(retry.searchParams.get("state") ?? "")
      ).resolves.toEqual({ destination: history, synchronizeCart: false });
      const identity = await f.read();
      expect(identity?.cartSynchronizationPending).toBeTruthy();
    } finally {
      await f.runtime.dispose();
    }
  });
});

describe("Customer cart connection recovery", () => {
  it("detaches the authenticated cart before discarding its browser credential", async () => {
    const f = customerCartFixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      await f.synchronize();
      expect(f.attachedToken()).toBe("customer-token-1");
      await f.detachBuyer();
      expect(f.attachedToken()).toBeUndefined();
      expect(f.values.has(CART_COOKIE_NAME)).toBeFalsy();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("discards the local cart credential even when native detachment cannot be confirmed", async () => {
    const f = customerCartFixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      await f.synchronize();
      f.setOutcome("responseLost");
      await expect(f.detachBuyer()).rejects.toMatchObject({
        _tag: "CartProviderFailure",
      });
      expect(f.values.has(CART_COOKIE_NAME)).toBeFalsy();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("never adopts another customer's cart while its own connection is pending", async () => {
    const f = customerCartFixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      f.setRemoteCustomer("gid://shopify/Customer/other");
      await expect(f.readCart()).rejects.toThrow(
        "Shopify cart does not match the buyer and selling context"
      );
      const result = await f.synchronize();
      expect(result).toMatchObject({
        failure: { _tag: "CartProviderFailure", reason: "unexpectedResponse" },
      });
      expect(f.attempts()).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("finishes a pending connection before editing cart lines and never replays the edit", async () => {
    const f = customerCartFixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      f.setOutcome("rejected");
      expect(Result.isFailure(await f.changeQuantity())).toBeTruthy();
      expect(f.lineWrites()).toBe(0);
      f.setOutcome("success");
      expect(Result.isSuccess(await f.changeQuantity())).toBeTruthy();
      expect(f.lineWrites()).toBe(1);
      expect(
        Option.getOrThrow(await f.readCart()).cart.lineItems
      ).toMatchObject([{ id: "line-1", quantity: 2 }]);
      await expect(f.destination()).resolves.toBeUndefined();
    } finally {
      await f.runtime.dispose();
    }
  });

  it.each(["rejected", "responseLost"] as const)(
    "retries guest cart attachment after %s without losing lines or signing in again",
    async (outcome) => {
      const f = customerCartFixture();
      try {
        const login = await f.login();
        await f.authorize(login.searchParams.get("state") ?? "");
        f.setOutcome(outcome);
        expect(Result.isFailure(await f.synchronize())).toBeTruthy();
        const cookiesBeforeRead = [...f.values];
        const pendingCart = Option.getOrThrow(await f.readCart());
        expect(pendingCart.cart.lineItems).toMatchObject([
          { id: "line-1", quantity: 1 },
        ]);
        expect([...f.values]).toEqual(cookiesBeforeRead);
        await expect(f.destination()).resolves.toContain("/account/refresh?");
        await expect(f.checkout()).rejects.toMatchObject({
          _tag: "CartProviderFailure",
          reason: "unavailable",
        });
        f.setOutcome("success");
        await f.handle("/account/refresh?return_to=/en-US/checkout");
        expect(Result.isSuccess(await f.synchronize())).toBeTruthy();
        await expect(f.destination()).resolves.toBeUndefined();
        await expect(f.checkout()).resolves.toBe(
          "https://example.myshopify.com/checkouts/customer"
        );
        expect(Option.getOrThrow(await f.readCart()).cart).toMatchObject({
          customerId: "gid://shopify/Customer/1",
          lineItems: [{ id: "line-1", quantity: 1 }],
        });
        expect([f.attempts(), f.requests()]).toEqual([2, 1]);
      } finally {
        await f.runtime.dispose();
      }
    }
  );

  it("keeps a refreshed customer session pending until its new token reaches the cart", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = customerCartFixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      expect(Result.isSuccess(await f.synchronize())).toBeTruthy();
      expect(f.attachedToken()).toBe("customer-token-1");
      vi.setSystemTime(Date.now() + 360_000);
      await f.handle("/account/refresh?return_to=/en-US/checkout");
      f.setOutcome("rejected");
      expect(Result.isFailure(await f.synchronize())).toBeTruthy();
      await expect(f.destination()).resolves.toContain("/account/refresh?");
      expect(f.attachedToken()).toBe("customer-token-1");
      f.setOutcome("success");
      await f.handle("/account/refresh?return_to=/en-US/checkout");
      expect(Result.isSuccess(await f.synchronize())).toBeTruthy();
      expect(f.attachedToken()).toBe("customer-token-2");
      await expect(f.destination()).resolves.toBeUndefined();
      expect(f.requests()).toBe(2);
    } finally {
      await f.runtime.dispose();
      vi.useRealTimers();
    }
  });
});

describe("Hydrogen customer sessions behind the provider", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes names in the current request's cookie store when the runtime is reused", async () => {
    const f = fixture();
    try {
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      const previous = new Map(f.values);
      const nextValues = new Map(f.values);
      f.setCookieStore({
        delete: (name) => {
          nextValues.delete(name);
        },
        get: (name) =>
          nextValues.has(name)
            ? { value: nextValues.get(name) ?? "" }
            : undefined,
        set: (name, value) => {
          nextValues.set(name, value);
        },
      });
      f.setCustomerFirstName("Updated");
      const refreshed = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.refreshProfile)
        )
      );
      expect(refreshed.firstName).toBe("Updated");
      const identity = await f.read();
      expect(identity?.customer.firstName).toBe("Updated");
      expect(f.values).toEqual(previous);
      expect(nextValues).not.toEqual(previous);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("reads current native profile names without changing the session cookies", async () => {
    const f = fixture();
    try {
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      const previous = new Map(f.values);
      f.setCustomerFirstName("Changed in Shopify");
      const customer = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.profile)
        )
      );
      expect(customer.firstName).toBe("Changed in Shopify");
      expect(f.values).toEqual(previous);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("preserves refreshed tokens and pending cart synchronization when updating the profile cookie", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    try {
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.completeCartSynchronization)
        )
      );
      vi.setSystemTime(Date.now() + 301_000);
      f.setCustomerFirstName("Updated after refresh");
      await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.refreshProfile)
        )
      );
      const identity = await f.read();
      expect(f.requests()).toBe(2);
      expect(
        identity?.accessToken === undefined
          ? undefined
          : Redacted.value(identity.accessToken)
      ).toBe("customer-token-2");
      expect(identity?.customer.firstName).toBe("Updated after refresh");
      expect(identity?.cartSynchronizationPending).toBeTruthy();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("requires Shopify to accept an unexpired token before entering authenticated checkout", async () => {
    const f = fixture();
    const checkout = ShopifyCustomerAccounts.pipe(
      Effect.flatMap((accounts) =>
        accounts.checkoutDestination("/en-US/checkout")
      )
    );
    try {
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.completeCartSynchronization)
        )
      );
      await expect(f.runtime.runPromise(checkout)).resolves.toBeUndefined();
      f.setProfileStatus(401);
      await expect(f.runtime.runPromise(checkout)).rejects.toMatchObject({
        _tag: "ShopifyCustomerSessionFailure",
        reason: "unauthenticated",
      });
    } finally {
      await f.runtime.dispose();
    }
  });

  it("uses guest authority until Shopify authenticates, then supplies the shared B2C principal and profile", async () => {
    const f = fixture();
    const request = new B2CPurchasingContextRequest({
      authUserId: AuthUserId.make("user-1"),
      store: resolveStore(
        { locale: CommerceLocale.make("en-US") },
        storeConfiguration
      ),
    });
    const context = CommerceContext.pipe(
      Effect.provide(b2cPurchasingContextLayer(request))
    );
    try {
      const guest = await f.runtime.runPromise(context);
      expect(guest.principal._tag).toBe("AnonymousCommercePrincipal");
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      const customer = await f.runtime.runPromise(context);
      expect(customer.principal).toMatchObject({
        _tag: "B2CPurchasingPrincipal",
        authUserId: "user-1",
        customerId: "gid://shopify/Customer/1",
      });
      await expect(
        f.runtime.runPromise(customer.customerProfile())
      ).resolves.toMatchObject({ customerId: "gid://shopify/Customer/1" });
    } finally {
      await f.runtime.dispose();
    }
  });

  it("uses the declared native context for a localized checkout handoff", async () => {
    const f = fixture();
    try {
      const result = await f.handle("/account/login?return_to=/fr-FR/checkout");
      const url = new URL(result.destination);
      expect(url.searchParams.get("region_country")).toBe("FR");
      expect(url.searchParams.get("locale")).toBe("fr-FR");
    } finally {
      await f.runtime.dispose();
    }
  });

  it("uses PKCE, trusted login hints, verified Shopify profiles and site-session binding", async () => {
    const f = fixture();
    try {
      await expect(f.read()).resolves.toBeUndefined();
      const url = await f.login();
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("redirect_uri")).toBe(
        `${origin}/account/authorize`
      );
      expect(url.searchParams.get("login_hint")).toBe("buyer@example.com");
      await expect(
        f.authorize(url.searchParams.get("state") ?? "")
      ).resolves.toEqual({
        destination: "/en-US/checkout",
        synchronizeCart: true,
      });
      const identity = await f.read();
      expect(identity?.customer.id).toBe("gid://shopify/Customer/1");
      expect(
        identity?.accessToken && Redacted.value(identity.accessToken)
      ).toBe("customer-token-1");
      expect([...f.values.values()].join("")).not.toContain("customer-token");
      f.setSession("another-session");
      await expect(f.read()).resolves.toBeUndefined();
      f.setSession("session-1");
      f.setUser("another-user");
      await expect(f.read()).resolves.toBeUndefined();
      f.setUser("");
      await expect(f.read()).resolves.toBeUndefined();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("prepares native logout before site sign-out and discards every Shopify cart credential", async () => {
    const f = fixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      const companyCart = `${CART_COOKIE_NAME}.0123456789abcdef0123`;
      f.values.set(CART_COOKIE_NAME, "private-cart");
      f.values.set(companyCart, "private-company-cart");
      f.values.set("site-preference", "preserve");
      const result = await f.logout({
        cookie: `${CART_COOKIE_NAME}=private-cart; ${companyCart}=private-company-cart; site-preference=preserve`,
        origin,
      });
      expect(result.destination).toBe("/account/logout/continue");
      expect(f.values.has(CART_COOKIE_NAME)).toBeFalsy();
      expect(f.values.has(companyCart)).toBeFalsy();
      expect([...f.values.values()].join("")).not.toContain("signature");
      f.setUser("");
      const continued = await f.handle(result.destination);
      const destination = new URL(continued.destination);
      expect(destination.origin).toBe("https://shopify.com");
      expect(destination.pathname).toBe("/authentication/123/logout");
      expect(destination.searchParams.get("id_token_hint")).toBeTruthy();
      expect(destination.searchParams.get("post_logout_redirect_uri")).toBe(
        `${origin}/account/logout/complete`
      );
      expect(f.values).toEqual(new Map([["site-preference", "preserve"]]));
      await expect(f.read()).resolves.toBeUndefined();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("clears local Shopify state when site authentication has already ended", async () => {
    const f = fixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      f.values.set(CART_COOKIE_NAME, "private-cart");
      f.setUser("");
      const prepared = await f.logout();
      const result = await f.handle(prepared.destination);
      expect(result).toEqual({
        destination: `${origin}/`,
        synchronizeCart: false,
      });
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it.each<HeadersInit>([
    { origin: "https://other.example" },
    { host: "store.example", origin: "https://other.example" },
    {
      host: "internal:3000",
      origin: "https://other.example",
      "x-forwarded-host": "store.example",
      "x-forwarded-proto": "https",
    },
    {
      host: "store.example",
      origin,
      "x-forwarded-proto": "http",
    },
    { origin: "null", referer: `${origin}/sign-out` },
    {},
  ])(
    "rejects an unverified logout without changing customer cookies: %j",
    async (headers) => {
      const f = fixture();
      try {
        const login = await f.login();
        await f.authorize(login.searchParams.get("state") ?? "");
        const before = new Map(f.values);
        await expect(f.logout(headers)).rejects.toBeDefined();
        expect(f.values).toEqual(before);
      } finally {
        await f.runtime.dispose();
      }
    }
  );

  it.each<HeadersInit>([
    {
      host: "web.shopify-b2c.localhost",
      origin: "https://web.shopify-b2c.localhost",
      "x-forwarded-proto": "https",
    },
    {
      host: "localhost:3000",
      origin: "https://web.shopify-b2c.localhost",
      "x-forwarded-host": "web.shopify-b2c.localhost",
      "x-forwarded-proto": "https",
    },
    {
      host: "web.shopify-b2c.localhost",
      referer: "https://web.shopify-b2c.localhost/sign-out",
      "x-forwarded-proto": "https",
    },
  ])(
    "accepts a same-origin storefront logout when the Shopify callback uses another host: %j",
    async (headers) => {
      const f = fixture();
      try {
        const login = await f.login();
        await f.authorize(login.searchParams.get("state") ?? "");
        const result = await f.logout(headers);
        expect(result.destination).toBe("/account/logout/continue");
        expect(f.values.has("shopify-customer.0")).toBeFalsy();
      } finally {
        await f.runtime.dispose();
      }
    }
  );

  it("returns to the current storefront after sign-out without a Shopify session", async () => {
    const f = fixture();
    try {
      const prepared = await f.logout({
        host: "web.shopify-b2c.localhost",
        origin: "https://web.shopify-b2c.localhost",
        "x-forwarded-proto": "https",
      });
      f.setUser("");
      const result = await f.handle(prepared.destination);
      expect(result.destination).toBe("https://web.shopify-b2c.localhost/");
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("rejects callback state mismatch before exchanging a code and clears pending login", async () => {
    const f = fixture();
    try {
      await f.login();
      await expect(f.authorize("wrong-state")).rejects.toBeDefined();
      expect(f.requests()).toBe(0);
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("logs out an ambient Shopify session belonging to a different shopper and retries once", async () => {
    const f = fixture();
    try {
      const url = await f.login();
      f.setCustomerEmail("other@example.com");
      const reset = await f.authorize(url.searchParams.get("state") ?? "");
      expect(new URL(reset.destination).pathname).toBe(
        "/authentication/123/logout"
      );
      await expect(f.read()).resolves.toBeUndefined();
      const next = await f.handle("/account/logout/complete");
      expect(next.destination).toBe(
        "/account/login?return_to=%2Fen-US%2Fcheckout"
      );
      const retry = await f.login();
      await expect(
        f.authorize(retry.searchParams.get("state") ?? "")
      ).rejects.toMatchObject({ reason: "identityMismatch" });
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("connects only the correct customer after resetting a mismatched native session", async () => {
    const f = fixture();
    try {
      const login = await f.login();
      f.setCustomerEmail("other@example.com");
      await f.authorize(login.searchParams.get("state") ?? "");
      await f.handle("/account/logout/complete");
      const retry = await f.login();
      f.setCustomerEmail("buyer@example.com");
      await expect(
        f.authorize(retry.searchParams.get("state") ?? "")
      ).resolves.toMatchObject({ synchronizeCart: true });
      const identity = await f.read();
      expect(identity?.customer.email).toBe("buyer@example.com");
      expect(
        [...f.values.keys()].some((name) =>
          name.startsWith("shopify-recovery.")
        )
      ).toBeFalsy();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("consumes logout continuation once and never applies it to a replacement site session", async () => {
    const f = fixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      const prepared = await f.logout();
      f.setSession("replacement-session");
      await expect(f.handle(prepared.destination)).resolves.toEqual({
        destination: `${origin}/`,
        synchronizeCart: false,
      });
      f.setUser("");
      await expect(f.handle(prepared.destination)).resolves.toEqual({
        destination: `${origin}/`,
        synchronizeCart: false,
      });
    } finally {
      await f.runtime.dispose();
    }
  });

  it("does not restart account recovery after the site session changes", async () => {
    const f = fixture();
    try {
      const login = await f.login();
      f.setCustomerEmail("other@example.com");
      await f.authorize(login.searchParams.get("state") ?? "");
      f.setSession("replacement-session");
      await expect(f.handle("/account/logout/complete")).resolves.toEqual({
        destination: `${origin}/`,
        synchronizeCart: false,
      });
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("keeps the recovery retry bound when the transient cookie expires during login", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    try {
      const login = await f.login();
      f.setCustomerEmail("other@example.com");
      await f.authorize(login.searchParams.get("state") ?? "");
      await f.handle("/account/logout/complete");
      const retry = await f.login();
      vi.setSystemTime(Date.now() + 121_000);
      await expect(
        f.authorize(retry.searchParams.get("state") ?? "")
      ).rejects.toMatchObject({ reason: "identityMismatch" });
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("expires the encrypted logout hint after two minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    try {
      const login = await f.login();
      await f.authorize(login.searchParams.get("state") ?? "");
      const prepared = await f.logout();
      f.setUser("");
      vi.setSystemTime(Date.now() + 121_000);
      await expect(f.handle(prepared.destination)).resolves.toEqual({
        destination: `${origin}/`,
        synchronizeCart: false,
      });
      expect(f.values.size).toBe(0);
    } finally {
      await f.runtime.dispose();
    }
  });

  it("keeps reads write-free and refreshes expired tokens only through writable operations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const f = fixture();
    try {
      const url = await f.login();
      await f.authorize(url.searchParams.get("state") ?? "");
      vi.setSystemTime(Date.now() + 360_000);
      const cookiesBeforeRead = [...f.values];
      const expired = await f.read();
      expect(expired?.accessToken).toBeUndefined();
      expect(f.requests()).toBe(1);
      expect([...f.values]).toEqual(cookiesBeforeRead);
      const destination = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) =>
            accounts.checkoutDestination("/en-US/checkout")
          )
        )
      );
      expect(destination).toContain("/account/refresh?");
      await expect(
        f.handle("/account/refresh?return_to=/en-US/checkout")
      ).resolves.toEqual({
        destination: "/en-US/checkout",
        synchronizeCart: true,
      });
      expect(f.requests()).toBe(2);
      const refreshed = await f.read();
      expect(refreshed?.accessToken).toBeDefined();
      vi.setSystemTime(Date.now() + 360_000);
      f.setRefreshStatus(401);
      const result = await f.runtime.runPromise(
        ShopifyCustomerAccounts.pipe(
          Effect.flatMap((accounts) => accounts.cartAccessToken),
          Effect.result
        )
      );
      expect(Result.isFailure(result)).toBeTruthy();
      await expect(f.read()).resolves.toBeUndefined();
    } finally {
      await f.runtime.dispose();
    }
  });

  it("limits return paths to this storefront", () => {
    for (const value of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "/".repeat(3000),
    ]) {
      expect(safeReturnTo(value, origin)).toBe("/");
    }
    expect(safeReturnTo("/en-US/cart?from=checkout", origin)).toBe(
      "/en-US/cart?from=checkout"
    );
  });
});
