import { createHash } from "node:crypto";

import { Effect, Schema } from "effect";

import type { AuthenticatedCommercePrincipal } from "../../domain/commerce-request-context";
import { OrderCursor, OrderQueryFailure } from "../../domain/order-history";
import type { ListOrdersInput } from "../../domain/order-history";
import { encodeOrderFilters } from "./filters";

/** Continuations are selectors, never authority; adapters still scope every native read. */
export const orderCursorCodec = <A, I extends Schema.Json>(
  provider: string,
  principal: AuthenticatedCommercePrincipal,
  input: ListOrdersInput,
  payload: Schema.Codec<A, I>
) => {
  const context = createHash("sha256")
    .update(
      JSON.stringify([
        provider,
        principal._tag,
        principal.customerId,
        principal._tag === "CustomerCommercePrincipal"
          ? [principal.businessUnitId, principal.businessUnitKey]
          : null,
        input.stores,
        input.locale,
        encodeOrderFilters(input.filters),
      ])
    )
    .digest("hex");
  const document = Schema.fromJsonString(
    Schema.Struct({
      context: Schema.Literal(context),
      payload,
      version: Schema.Literal(1),
    })
  );
  return {
    decode:
      input.after === undefined
        ? Effect.succeed(undefined)
        : Schema.decodeUnknownEffect(document)(
            Buffer.from(input.after, "base64url").toString("utf-8")
          ).pipe(
            Effect.map((value) => value.payload),
            Effect.mapError(
              () =>
                new OrderQueryFailure({
                  message:
                    "The order page has expired. Start from the first page.",
                  operation: "list",
                  reason: "invalidCursor",
                })
            )
          ),
    encode: (value: A) =>
      OrderCursor.make(
        Buffer.from(
          Schema.encodeSync(document)({ context, payload: value, version: 1 })
        ).toString("base64url")
      ),
  };
};
