import type { CartId } from "@repo/commerce-core/domain/cart";
import type { CurrentCartOperationFailure } from "@repo/commerce-core/domain/cart-errors";
import type { Effect } from "effect";

export interface CurrentCartCookie {
  readonly set: (
    id: CartId
  ) => Effect.Effect<void, CurrentCartOperationFailure>;
  readonly clear: () => Effect.Effect<void>;
}
