import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Redacted } from "effect";

import { EmailOrderAccess } from "../../domain/order-access";
import { OrderId } from "../../domain/order-identity";
import { OrderAccessLinks } from "../../services/order-access-links";
import { OrderQueries } from "../../services/order-queries";
import { CommerceLocale, StoreKey } from "../../store";
import { findEmailOrder } from "./find-email-order";

const access = new EmailOrderAccess({
  orderId: OrderId.make("order-1"),
  recipient: Redacted.make("buyer@example.test", { label: "email" }),
  storeKey: StoreKey.make("original"),
});
it.effect(
  "passes verified email authority and clamps the native read to its Order and Store",
  () => {
    let calls = 0;
    return Effect.gen(function* () {
      yield* findEmailOrder({
        id: OrderId.make("other-order"),
        locale: CommerceLocale.make("en-US"),
        token: Redacted.make("proof"),
      });
      expect(calls).toBe(0);
      yield* findEmailOrder({
        id: access.orderId,
        locale: CommerceLocale.make("en-US"),
        token: Redacted.make("proof"),
      });
      expect(calls).toBe(1);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(OrderAccessLinks, {
            issue: () => Effect.die("Not an issuer"),
            verify: () => Effect.succeed(Option.some(access)),
          }),
          Layer.succeed(OrderQueries, {
            findById: (principal, input) =>
              Effect.sync(() => {
                calls += 1;
                expect(principal).toEqual(access);
                expect(input).toEqual({
                  id: access.orderId,
                  locale: "en-US",
                  stores: { _tag: "SingleStore", storeKey: access.storeKey },
                });
                return Option.none();
              }),
            list: () => Effect.die("An email link cannot list Orders"),
          })
        )
      )
    );
  }
);
