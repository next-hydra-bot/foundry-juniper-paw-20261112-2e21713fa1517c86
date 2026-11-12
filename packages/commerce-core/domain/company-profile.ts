import { Schema } from "effect";

import { Address } from "./address";
import { CommerceBusinessUnitId } from "./commerce-account";

/** Provider-issued revision; callers only return it with an edit. */
export const CompanyProfileRevision = Schema.NonEmptyString.pipe(
  Schema.brand("CompanyProfileRevision")
);
export type CompanyProfileRevision = typeof CompanyProfileRevision.Type;

export class CompanyProfile extends Schema.Class<CompanyProfile>(
  "CompanyProfile"
)({
  billingAddress: Schema.optional(Address),
  businessUnitId: CommerceBusinessUnitId,
  companyName: Schema.String,
  name: Schema.String,
  phone: Schema.optional(Schema.String),
  revision: CompanyProfileRevision,
  shippingAddress: Schema.optional(Address),
}) {}

const EditableAddress = Address.mapFields((fields) => ({
  ...fields,
  addressLine1: Schema.Trim.check(Schema.isMinLength(1)),
  city: Schema.Trim.check(Schema.isMinLength(1)),
  postalCode: Schema.Trim.check(Schema.isMinLength(1)),
}));

export const SaveCompanyProfileInput = Schema.Struct({
  billingAddress: EditableAddress,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  phone: Schema.Trim.check(Schema.isMaxLength(100)),
  revision: CompanyProfileRevision,
  shippingAddress: EditableAddress,
});
export type SaveCompanyProfileInput = typeof SaveCompanyProfileInput.Type;

export class CompanyProfileForbidden extends Schema.TaggedError<CompanyProfileForbidden>()(
  "CompanyProfileForbidden",
  { message: Schema.String }
) {}
export class CompanyProfileChanged extends Schema.TaggedError<CompanyProfileChanged>()(
  "CompanyProfileChanged",
  { message: Schema.String }
) {}
export class CompanyProfileUnavailable extends Schema.TaggedError<CompanyProfileUnavailable>()(
  "CompanyProfileUnavailable",
  { message: Schema.String }
) {}
export class CompanyProfileWriteOutcomeUnknown extends Schema.TaggedError<CompanyProfileWriteOutcomeUnknown>()(
  "CompanyProfileWriteOutcomeUnknown",
  { message: Schema.String }
) {}

export const CompanyProfileFailure = Schema.Union([
  CompanyProfileForbidden,
  CompanyProfileChanged,
  CompanyProfileUnavailable,
  CompanyProfileWriteOutcomeUnknown,
]);
export type CompanyProfileFailure = typeof CompanyProfileFailure.Type;
