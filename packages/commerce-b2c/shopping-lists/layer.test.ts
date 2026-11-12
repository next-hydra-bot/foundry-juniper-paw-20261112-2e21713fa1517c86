import { expect, it } from "@effect/vitest";
import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
} from "@repo/commerce-core/domain/commerce-account";
import { ShoppingLists } from "@repo/commerce-core/services/shopping-lists";
import { StoreKey } from "@repo/commerce-core/store";
import { Effect, Layer } from "effect";

import { withShoppingListAuthorization } from "./layer";

const storeKey = StoreKey.make("store");
const buyer = {
  authUserId: AuthUserId.make("actor"),
};
const company = {
  authUserId: buyer.authUserId,

  businessUnit: {
    id: CommerceBusinessUnitId.make("company"),
    key: CommerceBusinessUnitKey.make("company"),
  },
};
const unused = () => Effect.die("Unexpected shopping-list operation");
it.effect(
  "lists the explicit Customer and Store without company permission grants",
  () =>
    Effect.gen(function* () {
      const lists = yield* ShoppingLists;
      yield* lists.list(buyer, { storeKey, ownership: "mine", limit: 20 });
    }).pipe(
      Effect.provide(
        withShoppingListAuthorization(
          Layer.succeed(ShoppingLists, {
            get: unused,
            create: unused,
            update: unused,
            delete: unused,
            list: (principal, input) =>
              Effect.sync(() => {
                expect(principal).toEqual(buyer);
                expect(input.storeKey).toBe(storeKey);
                return { items: [] };
              }),
          })
        )
      )
    )
);
it.effect("rejects company purchasing before accessing Customer lists", () =>
  Effect.gen(function* () {
    const lists = yield* ShoppingLists;
    const failure = yield* lists
      .list(company, { storeKey, ownership: "mine", limit: 20 })
      .pipe(Effect.flip);
    expect(failure).toMatchObject({ reason: "accessDenied" });
  }).pipe(
    Effect.provide(
      withShoppingListAuthorization(
        Layer.succeed(ShoppingLists, {
          get: unused,
          create: unused,
          update: unused,
          delete: unused,
          list: unused,
        })
      )
    )
  )
);
it.effect(
  "uses each call's buyer rather than retaining the first Customer",
  () => {
    const observed: string[] = [];
    const layer = withShoppingListAuthorization(
      Layer.succeed(ShoppingLists, {
        get: unused,
        create: unused,
        update: unused,
        delete: unused,
        list: (principal) =>
          Effect.sync(() => {
            observed.push(principal.authUserId);
            return { items: [] };
          }),
      })
    );
    return Effect.gen(function* () {
      const lists = yield* ShoppingLists;
      yield* lists.list(buyer, { storeKey, ownership: "mine", limit: 20 });
      const other = {
        authUserId: AuthUserId.make("another-actor"),
      };
      yield* lists.list(other, { storeKey, ownership: "mine", limit: 20 });
      expect(observed).toEqual(["actor", "another-actor"]);
    }).pipe(Effect.provide(layer));
  }
);
