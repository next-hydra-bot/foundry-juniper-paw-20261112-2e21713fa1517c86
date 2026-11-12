import { Context } from "effect";
import type { Effect, Option } from "effect";

import type {
  CartProviderFailure,
  CartMutationRejected,
  CurrentCartSelectionConflict,
  CurrentCartOperationFailure,
} from "../domain/cart-errors";
import type { CartSnapshot } from "../domain/cart-snapshot";
import type { Carts, CreateCartFailure } from "./carts";

/** Provider-owned selection and persistence; credentials stay behind this interface. */
export class CurrentCartStorage extends Context.Service<
  CurrentCartStorage,
  {
    readonly resolve: () => Effect.Effect<
      Option.Option<CartSnapshot>,
      CartProviderFailure | CurrentCartSelectionConflict
    >;
    readonly create: () => Effect.Effect<
      CartSnapshot,
      CreateCartFailure | CurrentCartOperationFailure | CartMutationRejected
    >;
    readonly forget: () => Effect.Effect<void>;
    readonly addItem: Carts["Service"]["addItem"];
    readonly setLineItemQuantity: Carts["Service"]["setLineItemQuantity"];
    readonly removeLineItem: Carts["Service"]["removeLineItem"];
    readonly changeDiscountCode: Carts["Service"]["changeDiscountCode"];
  }
>()("@repo/commerce-core/CurrentCartStorage") {}
