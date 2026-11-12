import { describe, expect, it } from "@effect/vitest";
import { NextRequestApi } from "@repo/actions/next-request";
import type { NextCookieSetOptions } from "@repo/actions/next-request";
import {
  LineItemId,
  PositiveCartQuantity,
  VariantId,
} from "@repo/commerce-core/domain/cart";
import { CommerceCustomerId } from "@repo/commerce-core/domain/commerce-account";
import {
  AnonymousCommerceContextRequest,
  AuthUserId,
  B2CPurchasingPrincipal,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import {
  CommerceLocale,
  resolveStore,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";

import { startCheckout } from "../checkout/programs";
import { ShopifyRequestFailure } from "../client/storefront";
import { guestCommerceContextLayer } from "../testing/commerce-context";
import type { ShopifyRequest } from "../testing/storefront";
import { storefrontFixture } from "../testing/storefront";
import { currentCartLayer, cartStorageLayerWith } from "./index";
import { publicCartId, mapCart } from "./mapping";
import { CartCookieJson, ShopifyCart } from "./schema";
import { CART_COOKIE_NAME, ShopifyCartSession } from "./session";

const store = resolveStore(
  { locale: CommerceLocale.make("en-US") },
  storeConfiguration
);
const privateId = "gid://shopify/Cart/example?key=private-example";
const money = { amount: "12.00", currencyCode: "USD" };
const attributionResult = {
  cartMetafieldsSet: {
    metafields: [
      {
        key: "store_key",
        namespace: "commerce",
        type: "single_line_text_field",
        value: store.storeKey,
      },
    ],
    userErrors: [],
  },
};
const cart = (quantity = 1) => ({
  buyerIdentity: { countryCode: "US", customer: null, purchasingCompany: null },
  checkoutUrl: "https://example.myshopify.com/checkouts/current",
  cost: { totalAmount: money },
  discountApplications: [],
  discountCodes: [],
  id: privateId,
  lines: {
    nodes: quantity
      ? [
          {
            cost: {
              amountPerQuantity: money,
              compareAtAmountPerQuantity: null,
              subtotalAmount: money,
              totalAmount: money,
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
              sku: "SKU",
            },
            quantity,
          },
        ]
      : [],
    pageInfo: { endCursor: null, hasNextPage: false },
  },
  storeAttribution: { type: "single_line_text_field", value: store.storeKey },
  totalQuantity: quantity,
});

const fixture = (
  execute: (
    request: ShopifyRequest
  ) => Effect.Effect<Schema.Json, ShopifyRequestFailure>,
  initial?: string,
  buyer?: { readonly customerId: string; readonly scope: string }
) => {
  const values = new Map(initial ? [[CART_COOKIE_NAME, initial]] : []);
  const writes: {
    readonly options?: NextCookieSetOptions;
    readonly value: string;
  }[] = [];
  const cookies = {
    delete: (name: string) => {
      values.delete(name);
    },
    get: (name: string) => {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    set: (name: string, value: string, options?: NextCookieSetOptions) => {
      values.set(name, value);
      writes.push({ options, value });
    },
  };
  const stable = Layer.mergeAll(
    storefrontFixture(execute),
    Layer.succeed(NextRequestApi, {
      connect: () => Effect.void,
      getCookies: () => Effect.succeed(cookies),
      getLocale: () => Effect.succeed("en-US"),
    }),
    CartPolicies.layerEmpty,
    buyer
      ? Layer.succeed(CommerceContext, {
          customerPrincipal: () =>
            Effect.fail(
              new CommerceRequestContextNotFound({
                message: "unused",
                reason: "noPrincipal",
              })
            ),
          customerProfile: () =>
            Effect.fail(
              new CommerceRequestContextNotFound({
                message: "unused",
                reason: "noPrincipal",
              })
            ),
          principal: new B2CPurchasingPrincipal({
            authUserId: AuthUserId.make("site-user"),
            customerId: CommerceCustomerId.make(buyer.customerId),
          }),
          store,
        })
      : guestCommerceContextLayer(
          new AnonymousCommerceContextRequest({ store })
        )
  );
  const storageLayer = cartStorageLayerWith(
    Effect.succeed({
      ...buyer,
      accessToken: Effect.succeed(buyer ? "customer-token" : undefined),
    })
  );
  return {
    layer: (buyer
      ? CurrentCart.layerFromStorage.pipe(Layer.provide(storageLayer))
      : currentCartLayer
    ).pipe(Layer.provideMerge(stable)),
    stable,
    storageLayer: storageLayer.pipe(Layer.provideMerge(stable)),
    values,
    writes,
  };
};
const cookie = (overrides = {}) =>
  Schema.encodeSync(CartCookieJson)({
    id: privateId,
    locale: store.locale,
    shop: "example.myshopify.com",
    storeKey: store.storeKey,
    ...overrides,
  });
const item = {
  quantity: PositiveCartQuantity.make(1),
  variantId: VariantId.make("variant-1"),
};

it.effect(
  "persists a private HttpOnly credential while public cart actions expose only a correlation identity",
  () =>
    Effect.gen(function* () {
      const requests: ShopifyRequest[] = [];
      const f = fixture((request) =>
        Effect.sync((): Schema.Json => {
          requests.push(request);
          if (request.query.includes("cartMetafieldsSet(")) {
            return attributionResult;
          }
          if (request.query.includes("cartCreate(")) {
            return {
              cartCreate: { cart: cart(0), userErrors: [], warnings: [] },
            };
          }
          if (request.query.includes("cartLinesAdd(")) {
            return {
              cartLinesAdd: { cart: cart(), userErrors: [], warnings: [] },
            };
          }
          return { cart: cart(0) };
        })
      );
      const state = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer)
      );
      expect(state.cart.id).toBe(publicCartId(privateId));
      expect(JSON.stringify(state)).not.toContain("private-example");
      expect(f.writes[0]?.options).toMatchObject({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      });
      expect(
        requests.slice(0, 2).map(({ variables }) => variables)
      ).toMatchObject([
        { input: { buyerIdentity: { countryCode: "US" } } },
        {
          metafields: [
            {
              key: "commerce.store_key",
              ownerId: privateId,
              type: "single_line_text_field",
              value: store.storeKey,
            },
          ],
        },
      ]);
      expect(requests.at(-1)?.variables).toMatchObject({
        id: privateId,
        lines: [{ merchandiseId: "variant-1", quantity: 1 }],
      });
    })
);

it.effect(
  "never retries an uncertain add and keeps private IDs out of its declared failure",
  () =>
    Effect.gen(function* () {
      let writes = 0;
      const f = fixture(
        (request) =>
          request.query.includes("cartLinesAdd(")
            ? Effect.sync(() => {
                writes += 1;
              }).pipe(
                Effect.andThen(
                  new ShopifyRequestFailure({ reason: "unavailable" })
                )
              )
            : Effect.succeed({ cart: cart() }),
        cookie()
      );
      const result = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer),
        Effect.result
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CartWriteOutcomeUnknown", operation: "addItem" },
      });
      expect(JSON.stringify(result)).not.toContain("private-example");
      expect(writes).toBe(1);
    })
);

it.effect(
  "preserves declared mutation rejection instead of treating it as an outage",
  () =>
    Effect.gen(function* () {
      const f = fixture(
        (request) =>
          Effect.succeed<Schema.Json>(
            request.query.includes("cartLinesUpdate(")
              ? {
                  cartLinesUpdate: {
                    cart: null,
                    userErrors: [
                      {
                        code: "INVALID",
                        field: ["lines"],
                        message: "Quantity is unavailable",
                      },
                    ],
                    warnings: [],
                  },
                }
              : { cart: cart() }
          ),
        cookie()
      );
      const result = yield* CurrentCart.setLineItemQuantity({
        lineItemId: LineItemId.make("line-1"),
        quantity: PositiveCartQuantity.make(2),
      }).pipe(Effect.provide(f.layer), Effect.result);
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "CartMutationRejected",
          operation: "setLineItemQuantity",
        },
      });
    })
);

for (const overrides of [
  { shop: "other.myshopify.com" },
  { storeKey: "another-store" },
  { locale: "en-GB" },
]) {
  it.effect(
    `ignores a cart credential from another scope: ${JSON.stringify(overrides)}`,
    () =>
      Effect.gen(function* () {
        let reads = 0;
        const f = fixture(
          () =>
            Effect.sync(() => {
              reads += 1;
              return { cart: cart() };
            }),
          cookie(overrides)
        );
        const current = yield* CurrentCart.get().pipe(Effect.provide(f.layer));
        expect(Option.isNone(current)).toBeTruthy();
        expect(reads).toBe(0);
        expect(f.writes).toHaveLength(0);
      })
  );
}

for (const storeAttribution of [
  null,
  { type: "single_line_text_field", value: "another-store" },
]) {
  it.effect(
    `rejects native Cart attribution outside the selected Store: ${JSON.stringify(storeAttribution)}`,
    () =>
      Effect.gen(function* () {
        const requests: ShopifyRequest[] = [];
        const f = fixture((request) => {
          requests.push(request);
          return Effect.succeed({ cart: { ...cart(), storeAttribution } });
        }, cookie());
        const exit = yield* CurrentCart.addItem(item).pipe(
          Effect.provide(f.layer),
          Effect.exit
        );
        expect(exit._tag).toBe("Failure");
        expect(requests).toHaveLength(1);
        expect(requests[0]?.query).toContain("query Cart(");
        expect(f.writes).toHaveLength(0);
      })
  );
}

it.effect(
  "does not persist a created Cart whose Store attribution cannot be confirmed",
  () =>
    Effect.gen(function* () {
      const f = fixture((request) =>
        Effect.succeed<Schema.Json>(
          request.query.includes("cartCreate(")
            ? {
                cartCreate: {
                  cart: { ...cart(0), storeAttribution: null },
                  userErrors: [],
                  warnings: [],
                },
              }
            : {
                cartMetafieldsSet: {
                  metafields: null,
                  userErrors: [{ message: "Not available" }],
                },
              }
        )
      );
      const outcome = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer),
        Effect.result
      );
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CartWriteOutcomeUnknown" },
      });
      expect(f.writes).toHaveLength(0);
    })
);

it.effect(
  "does not retry or persist an uncertain Store attribution write",
  () =>
    Effect.gen(function* () {
      let writes = 0;
      const f = fixture((request) => {
        if (request.query.includes("cartCreate(")) {
          return Effect.succeed({
            cartCreate: {
              cart: { ...cart(0), storeAttribution: null },
              userErrors: [],
              warnings: [],
            },
          });
        }
        writes += 1;
        return Effect.fail(
          new ShopifyRequestFailure({ reason: "unavailable" })
        );
      });
      const outcome = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer),
        Effect.result
      );
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CartWriteOutcomeUnknown" },
      });
      expect(writes).toBe(1);
      expect(f.writes).toHaveLength(0);
    })
);

it.effect(
  "reads every cart page without exposing the private pagination credential",
  () =>
    Effect.gen(function* () {
      const f = fixture(
        (request) =>
          Effect.sync(() => ({
            cart:
              request.variables.after !== null &&
              request.variables.after !== undefined
                ? {
                    ...cart(),
                    lines: {
                      ...cart().lines,
                      nodes: cart().lines.nodes.map((line) => ({
                        ...line,
                        id: "line-2",
                      })),
                    },
                  }
                : {
                    ...cart(),
                    lines: {
                      ...cart().lines,
                      pageInfo: { endCursor: "next-page", hasNextPage: true },
                    },
                    totalQuantity: 2,
                  },
          })),
        cookie()
      );
      const result = yield* CurrentCart.get().pipe(Effect.provide(f.layer));
      expect(
        Option.isSome(result) &&
          result.value.cart.lineItems.map((line) => line.id)
      ).toEqual(["line-1", "line-2"]);
    })
);

it.effect(
  "uses a fresh hosted checkout URL and performs no checkout mutation",
  () =>
    Effect.gen(function* () {
      let reads = 0;
      const f = fixture(
        (request) =>
          Effect.sync(() => {
            expect(request.query).toContain("query Cart");
            reads += 1;
            return {
              cart: {
                ...cart(),
                checkoutUrl: `https://example.myshopify.com/checkouts/${reads}`,
              },
            };
          }),
        cookie()
      );
      const url = yield* Effect.gen(function* () {
        yield* CurrentCart.get();
        return yield* startCheckout();
      }).pipe(Effect.provide(f.layer));
      expect(url).toBe("https://example.myshopify.com/checkouts/2");
    })
);

it.effect("blocks hosted checkout when Core cart policies fail", () =>
  Effect.gen(function* () {
    let reads = 0;
    const f = fixture(
      () =>
        Effect.sync(() => {
          reads += 1;
          return { cart: cart() };
        }),
      cookie()
    );
    const blocked = Layer.succeed(CartPolicies, {
      evaluate: () =>
        Effect.succeed([
          { code: "BLOCKED", targets: [{ type: "cart" as const }] },
        ]),
    });
    const result = yield* startCheckout().pipe(
      Effect.provide(
        currentCartLayer.pipe(
          Layer.provideMerge(Layer.merge(f.stable, blocked))
        )
      ),
      Effect.result
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "ShopifyCheckoutUnavailable", reason: "cartPolicy" },
    });
    expect(reads).toBe(1);
  })
);

it.effect(
  "reports an unknown outcome when an accepted cart write returns invalid monetary data",
  () =>
    Effect.gen(function* () {
      let writes = 0;
      const f = fixture(
        (request) =>
          Effect.sync((): Schema.Json => {
            if (request.query.includes("cartLinesAdd(")) {
              writes += 1;
              return {
                cartLinesAdd: {
                  cart: {
                    ...cart(),
                    cost: {
                      totalAmount: { amount: "invalid", currencyCode: "USD" },
                    },
                  },
                  userErrors: [],
                  warnings: [],
                },
              };
            }
            return { cart: cart() };
          }),
        cookie()
      );
      const result = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer),
        Effect.result
      );
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CartWriteOutcomeUnknown", operation: "addItem" },
      });
      expect(writes).toBe(1);
    })
);

it.effect(
  "replaces an expired or completed cart credential on the next shopping mutation",
  () =>
    Effect.gen(function* () {
      const replacement =
        "gid://shopify/Cart/new-example?key=new-private-example";
      let created = false;
      const f = fixture(
        (request) =>
          Effect.sync((): Schema.Json => {
            if (request.query.includes("cartMetafieldsSet(")) {
              return attributionResult;
            }
            if (request.query.includes("cartCreate(")) {
              created = true;
              return {
                cartCreate: {
                  cart: { ...cart(0), id: replacement },
                  userErrors: [],
                  warnings: [],
                },
              };
            }
            if (request.query.includes("cartLinesAdd(")) {
              return {
                cartLinesAdd: {
                  cart: { ...cart(), id: replacement },
                  userErrors: [],
                  warnings: [],
                },
              };
            }
            return { cart: created ? { ...cart(0), id: replacement } : null };
          }),
        cookie()
      );
      const state = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer)
      );
      expect(state.cart.id).toBe(publicCartId(replacement));
      expect(
        Schema.decodeUnknownSync(CartCookieJson)(f.values.get(CART_COOKIE_NAME))
          .id
      ).toBe(replacement);
    })
);

describe("Request isolation", () => {
  it("isolates cart credentials across requests sharing the same application runtime", async () => {
    const f = fixture(
      (request) =>
        Effect.succeed({
          cart: { ...cart(), id: request.variables.id ?? privateId },
        }),
      cookie()
    );
    const runtime = ManagedRuntime.make(f.stable);
    const program = CurrentCart.get().pipe(Effect.provide(currentCartLayer));
    try {
      const first = await runtime.runPromise(program);
      const secondId = "gid://shopify/Cart/second-request?key=second-private";
      f.values.set(CART_COOKIE_NAME, cookie({ id: secondId }));
      const second = await runtime.runPromise(program);
      expect(Option.isSome(first) && first.value.cart.id).toBe(
        publicCartId(privateId)
      );
      expect(Option.isSome(second) && second.value.cart.id).toBe(
        publicCartId(secondId)
      );
    } finally {
      await runtime.dispose();
    }
  });
});

it.effect(
  "attaches an existing guest cart, retaining lines and binding it to the verified customer session",
  () =>
    Effect.gen(function* () {
      const requests: ShopifyRequest[] = [];
      const buyer = {
        customerId: "gid://shopify/Customer/1",
        scope: "session-1",
      };
      let attached = false;
      const f = fixture(
        (request) => {
          requests.push(request);
          if (request.query.includes("mutation cartBuyerIdentityUpdate")) {
            attached = true;
            return Effect.succeed({
              cartBuyerIdentityUpdate: {
                cart: {
                  ...cart(),
                  buyerIdentity: {
                    ...cart().buyerIdentity,
                    customer: { id: buyer.customerId },
                  },
                },
                userErrors: [],
                warnings: [],
              },
            });
          }
          return Effect.succeed({
            cart: {
              ...cart(),
              buyerIdentity: {
                ...cart().buyerIdentity,
                customer: attached ? { id: buyer.customerId } : null,
              },
            },
          });
        },
        cookie(),
        buyer
      );
      yield* ShopifyCartSession.pipe(
        Effect.flatMap((session) => session.synchronizeBuyer()),
        Effect.provide(f.storageLayer)
      );
      expect(requests.at(-1)?.variables).toMatchObject({
        buyerIdentity: {
          countryCode: "US",
          customerAccessToken: "customer-token",
        },
        id: privateId,
      });
      const snapshot = yield* CurrentCart.get().pipe(Effect.provide(f.layer));
      expect(Option.getOrThrow(snapshot).cart).toMatchObject({
        customerId: buyer.customerId,
        lineItems: [{ quantity: 1 }],
      });
      expect(
        Schema.decodeSync(CartCookieJson)(f.values.get(CART_COOKIE_NAME) ?? "")
          .buyer
      ).toBe("session-1");
    })
);

it.effect(
  "cannot attach a cart that Shopify already assigns to another customer",
  () =>
    Effect.gen(function* () {
      let writes = 0;
      const f = fixture(
        (request) => {
          if (request.query.includes("mutation")) {
            writes += 1;
          }
          return Effect.succeed({
            cart: {
              ...cart(),
              buyerIdentity: {
                ...cart().buyerIdentity,
                customer: { id: "another-customer" },
              },
            },
          });
        },
        cookie(),
        { customerId: "customer-1", scope: "session-1" }
      );
      const result = yield* ShopifyCartSession.pipe(
        Effect.flatMap((session) => session.synchronizeBuyer()),
        Effect.provide(f.storageLayer),
        Effect.result
      );
      expect(result).toMatchObject({
        failure: { _tag: "CartProviderFailure" },
      });
      expect(writes).toBe(0);
    })
);

it.effect(
  "signed-out and different-session requests cannot select an authenticated cart cookie",
  () =>
    Effect.gen(function* () {
      let requests = 0;
      const execute = () => {
        requests += 1;
        return Effect.succeed({ cart: cart() });
      };
      const guest = fixture(execute, cookie({ buyer: "session-1" }));
      const switched = fixture(execute, cookie({ buyer: "session-1" }), {
        customerId: "customer-1",
        scope: "session-2",
      });
      const a = yield* CurrentCart.get().pipe(Effect.provide(guest.layer));
      const b = yield* CurrentCart.get().pipe(Effect.provide(switched.layer));
      expect([Option.isNone(a), Option.isNone(b), requests]).toEqual([
        true,
        true,
        0,
      ]);
    })
);

it.effect(
  "creates authenticated carts with the customer token and returns the shared customer-owned snapshot",
  () =>
    Effect.gen(function* () {
      const requests: ShopifyRequest[] = [];
      const buyer = {
        customerId: "gid://shopify/Customer/1",
        scope: "session-1",
      };
      const snapshot = (quantity: number) => ({
        ...cart(quantity),
        buyerIdentity: {
          ...cart().buyerIdentity,
          customer: { id: buyer.customerId },
        },
      });
      const f = fixture(
        (request) => {
          requests.push(request);
          if (request.query.includes("cartMetafieldsSet(")) {
            return Effect.succeed(attributionResult);
          }
          if (request.query.includes("mutation cartCreate")) {
            return Effect.succeed({
              cartCreate: { cart: snapshot(0), userErrors: [], warnings: [] },
            });
          }
          if (request.query.includes("mutation cartLinesAdd")) {
            return Effect.succeed({
              cartLinesAdd: { cart: snapshot(1), userErrors: [], warnings: [] },
            });
          }
          return Effect.succeed({ cart: snapshot(0) });
        },
        undefined,
        buyer
      );
      const result = yield* CurrentCart.addItem(item).pipe(
        Effect.provide(f.layer)
      );
      expect(requests[0]?.variables).toMatchObject({
        input: {
          buyerIdentity: {
            countryCode: "US",
            customerAccessToken: "customer-token",
          },
        },
      });
      expect(result.cart).toMatchObject({
        customerId: buyer.customerId,
        lineItems: [{ quantity: 1 }],
      });
    })
);

it.effect(
  "updates discount codes on the verified cart, preserving other codes and native applicability",
  () => {
    let native = {
      ...cart(2),
      discountCodes: [{ applicable: true, code: "WELCOME" }],
    };
    const submitted: unknown[] = [];
    const f = fixture(
      (request) =>
        Effect.sync((): Schema.Json => {
          if (request.query.includes("cartDiscountCodesUpdate(")) {
            const codes = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
              request.variables.codes
            );
            submitted.push({ codes, id: request.variables.id });
            native = {
              ...native,
              discountCodes: codes.map((code) => ({
                applicable: code === "WELCOME",
                code,
              })),
            };
            return {
              cartDiscountCodesUpdate: {
                cart: native,
                userErrors: [],
                warnings: [],
              },
            };
          }
          return { cart: native };
        }),
      cookie()
    );
    return Effect.gen(function* () {
      const added = yield* CurrentCart.changeDiscountCode({
        action: "add",
        code: "NOT-ELIGIBLE",
      });
      expect(added.cart.discountCodes).toEqual([
        { applicable: true, code: "WELCOME" },
        { applicable: false, code: "NOT-ELIGIBLE" },
      ]);
      const removed = yield* CurrentCart.changeDiscountCode({
        action: "remove",
        code: "not-eligible",
      });
      expect(removed.cart.discountCodes).toEqual([
        { applicable: true, code: "WELCOME" },
      ]);
      expect(submitted).toEqual([
        { codes: ["WELCOME", "NOT-ELIGIBLE"], id: privateId },
        { codes: ["WELCOME"], id: privateId },
      ]);
    }).pipe(Effect.provide(f.layer));
  }
);

describe("cart promotion projection", () => {
  it("uses native line and cart allocations and totals for an automatic cart promotion", () => {
    const native = cart(2);
    const application = {
      label: "Two for less",
      targetType: "LINE_ITEM",
      totalAllocatedAmount: { ...money, amount: "6.00" },
    };
    const mapped = mapCart(
      Schema.decodeUnknownSync(ShopifyCart)({
        ...native,
        cost: { totalAmount: { ...money, amount: "18.00" } },
        discountApplications: [application],
        lines: {
          ...native.lines,
          nodes: native.lines.nodes.map((line) => ({
            ...line,
            cost: {
              ...line.cost,
              compareAtAmountPerQuantity: { ...money, amount: "15.00" },
              subtotalAmount: { ...money, amount: "24.00" },
              totalAmount: { ...money, amount: "18.00" },
            },
            discountAllocations: [
              {
                discountedAmount: { ...money, amount: "6.00" },
                sourceDiscountApplication: application,
              },
            ],
          })),
        },
      }),
      store
    );
    expect(mapped.subtotalPrice?.centAmount).toBe(2400);
    expect(mapped.totalPrice.centAmount).toBe(1800);
    expect(mapped.lineItems[0]?.regularUnitPrice?.centAmount).toBe(1500);
    expect(mapped.discounts).toEqual([
      {
        amount: { centAmount: 600, currencyCode: "USD" },
        label: "Two for less",
        target: "items",
      },
    ]);
  });
});
