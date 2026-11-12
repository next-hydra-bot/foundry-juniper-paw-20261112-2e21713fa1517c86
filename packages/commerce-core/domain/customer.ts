import { Schema } from "effect";

export const CommerceCustomerId = Schema.NonEmptyString.pipe(
  Schema.brand("CommerceCustomerId")
);
export type CommerceCustomerId = typeof CommerceCustomerId.Type;

export const CustomerKey = Schema.NonEmptyString.pipe(
  Schema.brand("CustomerKey")
);
export type CustomerKey = typeof CustomerKey.Type;

export const CustomerDetails = Schema.Struct({
  email: Schema.Redacted(Schema.NonEmptyString, { label: "email" }),
  firstName: Schema.Redacted(Schema.String, { label: "personName" }),
  lastName: Schema.Redacted(Schema.String, { label: "personName" }),
});
export type CustomerDetails = typeof CustomerDetails.Type;

/** Creating a commerce profile does not establish an authenticated identity link. */
export const CustomerInput = Schema.Struct({
  ...CustomerDetails.fields,
  firstName: Schema.optionalKey(CustomerDetails.fields.firstName),
  key: CustomerKey,
  lastName: Schema.optionalKey(CustomerDetails.fields.lastName),
});
export type CustomerInput = typeof CustomerInput.Type;

/** Existing native Customers need not have an externally managed key. */
export const Customer = Schema.Struct({
  ...CustomerDetails.fields,
  customerId: CommerceCustomerId,
  key: Schema.optionalKey(CustomerKey),
});
export type Customer = typeof Customer.Type;
