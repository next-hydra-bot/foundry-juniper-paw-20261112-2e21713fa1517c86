import { Effect, Option } from "effect";

import type { FindEmailOrderInput } from "../../domain/order-access";
import type { OrderDetail } from "../../domain/order-history";
import { OrderAccessLinks } from "../../services/order-access-links";
import { OrderQueries } from "../../services/order-queries";

export const findEmailOrder = Effect.fn("EmailOrders.findById")(function* (
  input: FindEmailOrderInput
) {
  const access = yield* (yield* OrderAccessLinks).verify(input.token);
  if (Option.isNone(access) || access.value.orderId !== input.id) {
    return Option.none<OrderDetail>();
  }
  return yield* (yield* OrderQueries).findById(access.value, {
    id: input.id,
    locale: input.locale,
    stores: { _tag: "SingleStore", storeKey: access.value.storeKey },
  });
});
