import { Schema } from "effect";

export class ShopifyCustomerSessionFailure extends Schema.TaggedError<ShopifyCustomerSessionFailure>()(
  "ShopifyCustomerSessionFailure",
  {
    reason: Schema.Literals([
      "unavailable",
      "unauthenticated",
      "identityMismatch",
    ]),
  }
) {}
