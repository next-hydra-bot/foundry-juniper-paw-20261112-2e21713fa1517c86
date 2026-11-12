import { expect, it } from "@effect/vitest";
import { CommerceCustomerId } from "@repo/commerce-core/domain/commerce-account";
import {
  AnonymousCommercePrincipal,
  AuthUserId,
  B2CPurchasingPrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { CommercePrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import { CurrencyCode } from "@repo/commerce-core/domain/money";
import { ListOrdersInput } from "@repo/commerce-core/domain/order-history";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { CommerceLocale, Store, StoreKey } from "@repo/commerce-core/store";
import { Effect, Layer, Option, Schema } from "effect";

import { listOrders } from "./programs";

const principal = new B2CPurchasingPrincipal({
  authUserId: AuthUserId.make("user"),
  customerId: CommerceCustomerId.make("customer"),
});
const input = Schema.decodeUnknownSync(ListOrdersInput)({
  limit: 20,
  locale: "en-US",
  stores: { _tag: "AllStores" },
});
const context = (actor: CommercePrincipal) =>
  Layer.succeed(CommerceContext, {
    customerPrincipal: () => Effect.die("unused"),
    customerProfile: () => Effect.die("unused"),
    principal: actor,
    store: new Store({
      locale: CommerceLocale.make("en-US"),
      currency: CurrencyCode.make("USD"),
      storeKey: StoreKey.make("test-store"),
    }),
  });
it.effect(
  "reads the authenticated customer's own history without a company grant",
  () =>
    Effect.gen(function* () {
      const result = yield* listOrders(input);
      expect(result.items).toEqual([]);
    }).pipe(
      Effect.provide(
        Layer.merge(
          context(principal),
          Layer.succeed(OrderQueries, {
            findById: () => Effect.succeed(Option.none()),
            list: (owner, query) => {
              expect(owner).toEqual(principal);
              expect(query).toEqual(input);
              return Effect.succeed({ items: [] });
            },
          })
        )
      )
    )
);

it.effect("rejects anonymous readers before consulting the provider", () =>
  Effect.gen(function* () {
    const error = yield* listOrders(input).pipe(Effect.flip);
    expect(error).toMatchObject({
      _tag: "OrderQueryFailure",
      reason: "accessDenied",
    });
  }).pipe(
    Effect.provide(
      Layer.merge(
        context(new AnonymousCommercePrincipal({})),
        Layer.succeed(OrderQueries, {
          findById: () => Effect.die("unauthorized provider read"),
          list: () => Effect.die("unauthorized provider read"),
        })
      )
    )
  )
);
