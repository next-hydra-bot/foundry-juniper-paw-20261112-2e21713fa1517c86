import { Schema } from "effect";

/** Provider-issued identity; display numbers and Cart IDs are not Order IDs. */
export const OrderId = Schema.NonEmptyString.pipe(Schema.brand("OrderId"));
export type OrderId = typeof OrderId.Type;

export const OrderNumber = Schema.NonEmptyString.pipe(
  Schema.brand("OrderNumber")
);
export type OrderNumber = typeof OrderNumber.Type;
