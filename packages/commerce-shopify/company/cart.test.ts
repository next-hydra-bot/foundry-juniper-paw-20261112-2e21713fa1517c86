import { describe, expect, it } from "@effect/vitest";
import { NextRequestApi } from "@repo/actions/next-request";
import {
  PositiveCartQuantity,
  VariantId,
} from "@repo/commerce-core/domain/cart";
import { CartPolicies } from "@repo/commerce-core/services/cart-policies";
import { CurrentCart } from "@repo/commerce-core/services/current-cart";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

import { ShopifyCartSession } from "../cart/session";
import { checkoutDestination } from "../checkout/programs";
import { authenticatedCartStorageLayer } from "../customer-account/cart";
import {
  companyContextFixture,
  companyCustomerIdentity,
  customerAccountFixture,
} from "../testing/customer-account";
import { storefrontFixture } from "../testing/storefront";

const NativeBuyer = Schema.Struct({
  companyLocationId: Schema.String,
  countryCode: Schema.String,
  customerAccessToken: Schema.String,
});
const fixture = () => {
  let currentToken = "customer-token";
  const cookies = new Map<string, string>();
  const carts = new Map<
    string,
    { companyLocationId: string; quantity: number; token: string }
  >();
  const creations: (typeof NativeBuyer.Type)[] = [];
  const reconnections: (typeof NativeBuyer.Type)[] = [];
  const snapshot = (id: string) => {
    const cart = carts.get(id);
    if (!cart) {
      throw new Error("Missing fixture cart");
    }
    const amount = cart.companyLocationId.endsWith("/1") ? "150.00" : "165.00";
    const money = { amount, currencyCode: "USD" };
    return {
      buyerIdentity: {
        countryCode: "US",
        customer:
          cart.token === currentToken
            ? { id: "gid://shopify/Customer/1" }
            : null,
        purchasingCompany:
          cart.token === currentToken
            ? {
                company: { id: "gid://shopify/Company/1" },
                location: { id: cart.companyLocationId },
              }
            : null,
      },
      checkoutUrl: `https://example.myshopify.com/checkouts/${cart.companyLocationId.endsWith("/1") ? "gold" : "standard"}`,
      cost: { totalAmount: money },
      discountApplications: [],
      discountCodes: [],
      id,
      lines: {
        nodes: cart.quantity
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
                  product: { id: "product-1", title: "Attachment" },
                  selectedOptions: [],
                  sku: "ATTACH-STD",
                },
                quantity: cart.quantity,
              },
            ]
          : [],
        pageInfo: { endCursor: null, hasNextPage: false },
      },
      storeAttribution: {
        type: "single_line_text_field",
        value: "default-store",
      },
      totalQuantity: cart.quantity,
    };
  };
  const native = storefrontFixture((request) =>
    Effect.sync((): Schema.Json => {
      if (request.query.includes("cartMetafieldsSet(")) {
        expect(request.variables.metafields).toMatchObject([
          {
            key: "commerce.store_key",
            type: "single_line_text_field",
            value: "default-store",
          },
        ]);
        return {
          cartMetafieldsSet: {
            metafields: [
              {
                key: "store_key",
                namespace: "commerce",
                type: "single_line_text_field",
                value: "default-store",
              },
            ],
            userErrors: [],
          },
        };
      }
      if (request.query.includes("cartCreate(")) {
        const input = Schema.decodeUnknownSync(
          Schema.Struct({ buyerIdentity: NativeBuyer })
        )(request.variables.input);
        creations.push(input.buyerIdentity);
        const id = `gid://shopify/Cart/${carts.size + 1}?key=private`;
        carts.set(id, {
          companyLocationId: input.buyerIdentity.companyLocationId,
          quantity: 0,
          token: input.buyerIdentity.customerAccessToken,
        });
        return {
          cartCreate: { cart: snapshot(id), userErrors: [], warnings: [] },
        };
      }
      const id = Schema.decodeUnknownSync(Schema.String)(request.variables.id);
      if (request.query.includes("cartBuyerIdentityUpdate(")) {
        const buyer = Schema.decodeUnknownSync(NativeBuyer)(
          request.variables.buyerIdentity
        );
        const cart = carts.get(id);
        if (!cart) {
          throw new Error("Missing fixture cart");
        }
        cart.companyLocationId = buyer.companyLocationId;
        cart.token = buyer.customerAccessToken;
        reconnections.push(buyer);
        return {
          cartBuyerIdentityUpdate: {
            cart: snapshot(id),
            userErrors: [],
            warnings: [],
          },
        };
      }
      if (request.query.includes("cartLinesAdd(")) {
        const cart = carts.get(id);
        if (!cart) {
          throw new Error("Missing fixture cart");
        }
        cart.quantity += 1;
        return {
          cartLinesAdd: { cart: snapshot(id), userErrors: [], warnings: [] },
        };
      }
      return { cart: snapshot(id) };
    })
  );
  const forCompany = (id: number) => {
    const stable = Layer.mergeAll(
      native,
      customerAccountFixture({
        ...companyCustomerIdentity,
        accessToken: Redacted.make(currentToken),
      }),
      companyContextFixture(`gid://shopify/CompanyLocation/${id}`),
      CartPolicies.layerEmpty,
      Layer.succeed(NextRequestApi, {
        connect: () => Effect.void,
        getCookies: () =>
          Effect.succeed({
            delete: (name: string) => {
              cookies.delete(name);
            },
            get: (name: string) => {
              const value = cookies.get(name);
              return value ? { value } : undefined;
            },
            set: (name: string, value: string) => {
              cookies.set(name, value);
            },
          }),
        getLocale: () => Effect.succeed("en-US"),
      })
    );
    return CurrentCart.layerFromStorage.pipe(
      Layer.provideMerge(authenticatedCartStorageLayer),
      Layer.provideMerge(stable)
    );
  };
  return {
    carts,
    cookies,
    creations,
    forCompany,
    reconnections,
    rotateToken: () => {
      currentToken = "refreshed-token";
    },
  };
};
const add = CurrentCart.addItem({
  quantity: PositiveCartQuantity.make(1),
  variantId: VariantId.make("variant-1"),
});

describe("Shopify company cart and checkout", () => {
  it.effect(
    "preserves separate carts when switching companies and hands checkout the same buyer and native prices",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const gold = yield* add.pipe(Effect.provide(source.forCompany(1)));
        const standard = yield* add.pipe(Effect.provide(source.forCompany(2)));
        const restored = yield* CurrentCart.get().pipe(
          Effect.provide(source.forCompany(1))
        );
        const checkout = yield* checkoutDestination.pipe(
          Effect.provide(source.forCompany(1))
        );
        expect([
          gold.cart.lineItems[0]?.unitPrice.centAmount,
          standard.cart.lineItems[0]?.unitPrice.centAmount,
        ]).toEqual([15_000, 16_500]);
        expect(Option.getOrUndefined(restored)?.cart.id).toBe(gold.cart.id);
        expect({
          carts: source.carts.size,
          checkout,
          cookies: source.cookies.size,
        }).toEqual({
          carts: 2,
          checkout: "https://example.myshopify.com/checkouts/gold",
          cookies: 2,
        });
        expect(
          source.creations.map(({ companyLocationId, customerAccessToken }) => [
            companyLocationId,
            customerAccessToken,
          ])
        ).toEqual([
          ["gid://shopify/CompanyLocation/1", "customer-token"],
          ["gid://shopify/CompanyLocation/2", "customer-token"],
        ]);
        expect(gold.cart.buyingContext?.businessUnitId).toBe(
          "gid://shopify/CompanyLocation/1"
        );
      })
  );
  it.effect(
    "reconnects each existing company cart after token rotation without changing its lines",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const first = yield* add.pipe(Effect.provide(source.forCompany(1)));
        const second = yield* add.pipe(Effect.provide(source.forCompany(2)));
        source.rotateToken();
        for (const company of [1, 2]) {
          yield* Effect.gen(function* () {
            const session = yield* ShopifyCartSession;
            expect(yield* session.buyerSynchronizationPending).toBeTruthy();
            expect((yield* session.readCheckout().pipe(Effect.exit))._tag).toBe(
              "Failure"
            );
            yield* session.synchronizeBuyer();
            expect(yield* session.buyerSynchronizationPending).toBeFalsy();
            const checkout = yield* session.readCheckout();
            expect(checkout.cart.id).toBe(
              company === 1 ? first.cart.id : second.cart.id
            );
            expect(checkout.cart.lineItems[0]?.quantity).toBe(1);
          }).pipe(Effect.provide(source.forCompany(company)));
        }
        expect(
          source.reconnections.map(
            ({ customerAccessToken }) => customerAccessToken
          )
        ).toEqual(["refreshed-token", "refreshed-token"]);
        const pending = yield* ShopifyCartSession.pipe(
          Effect.flatMap((session) => session.buyerSynchronizationPending),
          Effect.provide(source.forCompany(1))
        );
        expect(pending).toBeFalsy();
        expect(source.carts.size).toBe(2);
      })
  );
  it.effect(
    "rejects a native cart whose company identity differs from its verified buying context",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* add.pipe(Effect.provide(source.forCompany(1)));
        const [cart] = source.carts.values();
        if (!cart) {
          return yield* Effect.die("Missing cart fixture");
        }
        cart.companyLocationId = "gid://shopify/CompanyLocation/2";
        const outcome = yield* ShopifyCartSession.pipe(
          Effect.flatMap((session) => session.readCheckout()),
          Effect.exit,
          Effect.provide(source.forCompany(1))
        );
        expect(outcome._tag).toBe("Failure");
      })
  );
});
