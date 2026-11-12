import { expect, it } from "@effect/vitest";
import type {
  NextCookieStore,
  NextCookieSetOptions,
} from "@repo/actions/next-request";
import { CartId } from "@repo/commerce-core/domain/cart";
import {
  ANONYMOUS_CART_COOKIE_NAME,
  decodeAnonymousCartCookie,
} from "@repo/commerce-core/lib/cart/utils/anonymous-cart-cookies";
import { Effect } from "effect";

import { makeB2CPurchasingRequest } from "./request";

const cookies = () => {
  const values = new Map<string, string>();
  const writes: NextCookieSetOptions[] = [];
  const store: NextCookieStore = {
    get: (name) => {
      const value = values.get(name);
      return value === undefined ? undefined : { value };
    },
    delete: (name) => {
      values.delete(name);
    },
    set: (name, value, options) => {
      values.set(name, value);
      if (options !== undefined) {
        writes.push(options);
      }
    },
  };
  return { store, values, writes };
};

it.effect(
  "selects B2C for an authenticated buyer without requiring a purchasing selector cookie",
  () =>
    Effect.gen(function* () {
      const jar = cookies();
      const request = yield* makeB2CPurchasingRequest(
        "en-US",
        jar.store,
        "auth-user"
      );
      expect(request.context).toMatchObject({
        _tag: "B2CPurchasingContextRequest",
        authUserId: "auth-user",
      });
      expect(request.context).not.toHaveProperty("businessUnitId");
    })
);

it.effect(
  "retains anonymous Cart authority through the shared HttpOnly cookie",
  () =>
    Effect.gen(function* () {
      const jar = cookies();
      const request = yield* makeB2CPurchasingRequest(
        "en-US",
        jar.store,
        undefined
      );
      yield* request.currentCartCookie.set(CartId.make("guest-cart"));
      const encoded = jar.values.get(ANONYMOUS_CART_COOKIE_NAME);
      expect(decodeAnonymousCartCookie(encoded)).toMatchObject({
        cartId: "guest-cart",
      });
      expect(jar.writes[0]).toMatchObject({ httpOnly: true, sameSite: "lax" });
      const next = yield* makeB2CPurchasingRequest(
        "en-US",
        jar.store,
        undefined
      );
      expect(next.context).toMatchObject({
        _tag: "AnonymousCommerceContextRequest",
        anonymousCartId: "guest-cart",
      });
      const otherMarket = yield* makeB2CPurchasingRequest(
        "de-DE",
        jar.store,
        undefined
      );
      expect(otherMarket.context).not.toHaveProperty("anonymousCartId");
    })
);
