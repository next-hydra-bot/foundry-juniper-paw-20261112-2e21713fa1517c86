import { CountryCode } from "@repo/commerce-core/domain/address";
import { AddressBookReference } from "@repo/commerce-core/domain/address-book";
import { Schema } from "effect";

const requiredText = (max: number) =>
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(max));

export const CustomerProfileInput = Schema.Struct({
  firstName: requiredText(80),
  lastName: requiredText(80),
});
export type CustomerProfileInput = typeof CustomerProfileInput.Type;

const customerAddressFields = {
  addressLine1: requiredText(120),
  addressLine2: Schema.Trim.check(Schema.isMaxLength(120)),
  city: requiredText(80),
  country: CountryCode,
  postalCode: requiredText(32),
  reference: AddressBookReference,
  region: Schema.Trim.check(Schema.isMaxLength(80)),
};

export const requireAddressRegion = Schema.makeFilter<{
  readonly country: string;
  readonly region: string;
}>((address) =>
  ["US", "CA"].includes(address.country) && address.region.length === 0
    ? { issue: "Enter a state or province.", path: ["region"] }
    : undefined
);

export const CustomerAddressInput = Schema.Struct(customerAddressFields).check(
  requireAddressRegion
);
export type CustomerAddressInput = typeof CustomerAddressInput.Type;

export const CustomerAddressChangeInput = Schema.Union([
  Schema.Struct({
    ...customerAddressFields,
    operation: Schema.Literal("edit"),
  }).check(requireAddressRegion),
  Schema.Struct({
    operation: Schema.Literals(["remove", "setDefault"]),
    reference: AddressBookReference,
  }),
]);
export type CustomerAddressChangeInput = typeof CustomerAddressChangeInput.Type;
