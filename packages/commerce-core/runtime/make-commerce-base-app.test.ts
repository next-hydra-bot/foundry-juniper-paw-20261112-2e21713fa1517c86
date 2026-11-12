import { describe, expect, it } from "@effect/vitest";
import { CartId } from "@repo/commerce-core/domain/cart";
import {
  AnonymousCommerceContextRequest,
  AnonymousCommercePrincipal,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import { ProductDiscovery } from "@repo/commerce-core/product/product-discovery";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { Carts } from "@repo/commerce-core/services/carts";
import { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { DeliveryPlanning } from "@repo/commerce-core/services/delivery-planning";
import { Orders } from "@repo/commerce-core/services/orders";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { CheckoutPayments } from "@repo/payments";
import { Context, Effect, Layer, Option } from "effect";

import { CartPolicies } from "../services/cart-policies";
import { CurrentCart } from "../services/current-cart";
import { makeCommerceBaseApp } from "./make-commerce-base-app";
import type { CommerceContextLayer } from "./make-commerce-base-app";

const store = resolveStore({ locale: CommerceLocale.make("en-US") });

const contextLayer: CommerceContextLayer = (request) => {
  if (request._tag !== "AnonymousCommerceContextRequest") {
    return Layer.effectContext(
      Effect.fail(
        new CommerceRequestContextNotFound({
          message: "This test composition permits anonymous purchasing",
          reason: "noPrincipal",
        })
      )
    );
  }
  return Layer.succeed(CommerceContext, {
    customerPrincipal: () =>
      Effect.fail(
        new CommerceRequestContextNotFound({
          message: "Anonymous buyer",
          reason: "noPrincipal",
        })
      ),
    customerProfile: () =>
      Effect.fail(
        new CommerceRequestContextNotFound({
          message: "Anonymous buyer",
          reason: "noPrincipal",
        })
      ),
    principal: new AnonymousCommercePrincipal({
      anonymousCartId: request.anonymousCartId,
    }),
    store: request.store,
  });
};

const makeApp = () =>
  makeCommerceBaseApp({
    layer: Layer.mergeAll(
      CartPolicies.layerEmpty,
      Carts.layerMemory({
        carts: ["cart-1", "cart-2"].map((id) => ({
          checkoutDetails: {},
          id: CartId.make(id),
          lineItems: [],
          status: "active",
          storeKey: store.storeKey,
          totalLineItemQuantity: 0,
          totalPrice: { centAmount: 0, currencyCode: "USD" },
        })),
      }),
      CommerceAccounts.layerMemory
    ),
    commerceContextLayer: contextLayer,
    currentCartLayer: (request) => CurrentCart.layer(request.currentCartCookie),
    productDiscoveryLayer: ProductDiscovery.testLayer(),
  });

const request = (id: string) => ({
  context: new AnonymousCommerceContextRequest({
    anonymousCartId: CartId.make(id),
    store,
  }),
  currentCartCookie: {
    clear: () => Effect.void,
    set: () => Effect.void,
  },
});

describe("Shared commerce composition", () => {
  it.effect(
    "provides shopping without custom checkout or payment services",
    () => {
      const app = makeApp();
      return Effect.gen(function* () {
        const services = yield* Effect.context();
        expect([
          Option.isNone(Context.getOption(services, CheckoutPayments)),
          Option.isNone(Context.getOption(services, Orders)),
          Option.isNone(Context.getOption(services, AddressBook)),
          Option.isNone(Context.getOption(services, DeliveryPlanning)),
        ]).toStrictEqual([true, true, true, true]);
        expect(Option.getOrThrow(yield* CurrentCart.get()).cart.id).toBe(
          "cart-1"
        );
        const products = yield* ProductDiscovery;
        expect(yield* products.listCards({ limit: 10 })).toStrictEqual([]);
      }).pipe(app.provide(request("cart-1")), Effect.provide(app.layer));
    }
  );

  it.effect("resolves a separate Current Cart for every request", () => {
    const app = makeApp();
    return Effect.gen(function* () {
      const first = yield* CurrentCart.get().pipe(
        app.provide(request("cart-1"))
      );
      const second = yield* CurrentCart.get().pipe(
        app.provide(request("cart-2"))
      );
      expect(Option.getOrThrow(first).cart.id).toBe("cart-1");
      expect(Option.getOrThrow(second).cart.id).toBe("cart-2");
    }).pipe(Effect.provide(app.layer));
  });
});
