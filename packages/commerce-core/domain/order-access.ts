import { Schema } from "effect";

import { CommerceLocale, StoreKey } from "../store";
import { CustomerDetails } from "./customer";
import { OrderId } from "./order-identity";

/** Proof of delivery to one personal Order's recorded recipient, never an account identity. */
export class EmailOrderAccess extends Schema.TaggedClass<EmailOrderAccess>()(
  "EmailOrderAccess",
  {
    orderId: OrderId,
    recipient: CustomerDetails.fields.email,
    storeKey: StoreKey,
  }
) {}

export const OrderAccessToken = Schema.Redacted(
  Schema.NonEmptyString.check(Schema.isMaxLength(4096)),
  { label: "orderAccessToken" }
);
export type OrderAccessToken = typeof OrderAccessToken.Type;

export const FindEmailOrderInput = Schema.Struct({
  id: OrderId,
  locale: CommerceLocale,
  token: OrderAccessToken,
});
export type FindEmailOrderInput = typeof FindEmailOrderInput.Type;
