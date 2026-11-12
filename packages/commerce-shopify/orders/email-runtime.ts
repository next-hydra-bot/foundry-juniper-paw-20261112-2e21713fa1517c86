import "server-only";
import type { FindEmailOrderInput } from "@repo/commerce-core/domain/order-access";
import { orderAccessLinksLayer } from "@repo/commerce-core/lib/orders/access-links";
import { findEmailOrder } from "@repo/commerce-core/lib/orders/find-email-order";
import { Effect, Layer, ManagedRuntime } from "effect";

import { orderQueriesLayer } from "./queries";

const runtime = ManagedRuntime.make(
  Layer.merge(orderQueriesLayer, orderAccessLinksLayer)
);
export const loadEmailOrder = async (input: FindEmailOrderInput) =>
  await runtime.runPromise(
    findEmailOrder(input).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Email order detail could not be loaded")
      ),
      Effect.match({
        onFailure: (error) => ({ error: error.reason }),
        onSuccess: (value) => ({ value }),
      })
    )
  );
