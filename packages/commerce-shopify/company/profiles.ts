import "server-only";
import { createHash } from "node:crypto";

import { CountryCode } from "@repo/commerce-core/domain/address";
import type { Address } from "@repo/commerce-core/domain/address";
import { CommerceBusinessUnitId } from "@repo/commerce-core/domain/commerce-account";
import {
  CompanyProfile,
  CompanyProfileRevision,
  CompanyProfileChanged,
  CompanyProfileUnavailable,
  CompanyProfileWriteOutcomeUnknown,
} from "@repo/commerce-core/domain/company-profile";
import { CompanyProfiles } from "@repo/commerce-core/services/company-profiles";
import { Effect, Layer, Schema } from "effect";

import {
  ShopifyCompanyAdmin,
  decodeCompanyResource,
  companyMutationResult,
} from "./admin";

const NativeAddress = Schema.Struct({
  address1: Schema.String,
  address2: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  countryCode: CountryCode,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  recipient: Schema.NullOr(Schema.String),
  zip: Schema.NullOr(Schema.String),
  zoneCode: Schema.NullOr(Schema.String),
});
const Location = Schema.Struct({
  billingAddress: Schema.NullOr(NativeAddress),
  company: Schema.Struct({ id: Schema.String, name: Schema.String }),
  id: Schema.String,
  name: Schema.String,
  phone: Schema.NullOr(Schema.String),
  shippingAddress: Schema.NullOr(NativeAddress),
  updatedAt: Schema.String,
});
const addressFields =
  "address1 address2 city countryCode zip zoneCode firstName lastName phone recipient";
const fields = `id name phone updatedAt company { id name } shippingAddress { ${addressFields} } billingAddress { ${addressFields} }`;
const uncertain = () =>
  new CompanyProfileWriteOutcomeUnknown({
    message:
      "The complete save could not be confirmed. Refresh company details before trying again.",
  });
const revision = (location: typeof Location.Type) =>
  CompanyProfileRevision.make(
    createHash("sha256")
      .update(Schema.encodeSync(Schema.fromJsonString(Location))(location))
      .digest("hex")
  );
const fromAddress = (address: typeof NativeAddress.Type): Address => ({
  addressLine1: address.address1,
  addressLine2: address.address2 ?? undefined,
  city: address.city ?? "",
  country: address.countryCode,
  postalCode: address.zip ?? "",
  region: address.zoneCode ?? undefined,
});
const toAddress = (
  address: Address,
  current: typeof NativeAddress.Type | null
) => ({
  address1: address.addressLine1,
  address2: address.addressLine2 === "" ? null : (address.addressLine2 ?? null),
  city: address.city,
  countryCode: address.country,
  firstName: current?.firstName ?? null,
  lastName: current?.lastName ?? null,
  phone: current?.phone ?? null,
  recipient: current?.recipient ?? null,
  zip: address.postalCode,
  zoneCode: address.region === "" ? null : (address.region ?? null),
});
const project = (location: typeof Location.Type) =>
  new CompanyProfile({
    billingAddress: location.billingAddress
      ? fromAddress(location.billingAddress)
      : undefined,
    businessUnitId: CommerceBusinessUnitId.make(location.id),
    companyName: location.company.name,
    name: location.name,
    phone: location.phone ?? undefined,
    revision: revision(location),
    shippingAddress: location.shippingAddress
      ? fromAddress(location.shippingAddress)
      : undefined,
  });

export const companyProfilesLayerFromAdmin = Layer.effect(
  CompanyProfiles,
  Effect.gen(function* () {
    const admin = yield* ShopifyCompanyAdmin;
    const read = (id: string) =>
      admin
        .request(
          `query CompanyProfile($id:ID!) { companyLocation(id:$id) { ${fields} } }`,
          { id }
        )
        .pipe(
          Effect.flatMap((data) =>
            decodeCompanyResource(Location, data.companyLocation)
          ),
          Effect.flatMap((location) =>
            location.id === id
              ? Effect.succeed(location)
              : Effect.fail(
                  new CompanyProfileUnavailable({
                    message: "Shopify returned another company location.",
                  })
                )
          ),
          Effect.mapError(
            () =>
              new CompanyProfileUnavailable({
                message: "Company details could not be read.",
              })
          )
        );
    return CompanyProfiles.of({
      get: (principal) =>
        read(principal.businessUnitId).pipe(Effect.map(project)),
      save: (principal, input) =>
        Effect.gen(function* () {
          const current = yield* read(principal.businessUnitId);
          if (revision(current) !== input.revision) {
            return yield* new CompanyProfileChanged({
              message:
                "Company details changed. Refresh before saving your changes.",
            });
          }
          // Updating details and each address are distinct native operations.
          const details = yield* admin
            .request(
              `mutation CompanyProfileSave($id:ID!,$input:CompanyLocationUpdateInput!) { companyLocationUpdate(companyLocationId:$id,input:$input) { companyLocation { id } userErrors { message } } }`,
              {
                id: principal.businessUnitId,
                input: { name: input.name, phone: input.phone || null },
              }
            )
            .pipe(Effect.mapError(uncertain));
          const outcome = yield* decodeCompanyResource(
            Schema.Struct({
              companyLocation: Schema.NullOr(
                Schema.Struct({ id: Schema.String })
              ),
              userErrors: Schema.Array(
                Schema.Struct({ message: Schema.String })
              ),
            }),
            details.companyLocationUpdate
          ).pipe(Effect.mapError(uncertain));
          if (
            outcome.userErrors.length > 0 &&
            outcome.companyLocation === null
          ) {
            return yield* new CompanyProfileUnavailable({
              message:
                "Shopify rejected the company details. Check the name and phone number.",
            });
          }
          if (
            outcome.userErrors.length > 0 ||
            outcome.companyLocation?.id !== principal.businessUnitId
          ) {
            return yield* uncertain();
          }
          // Once details may have committed, any failure requires a fresh read.
          return yield* Effect.gen(function* () {
            for (const [kind, address, prior] of [
              ["SHIPPING", input.shippingAddress, current.shippingAddress],
              ["BILLING", input.billingAddress, current.billingAddress],
            ] as const) {
              const data = yield* admin.request(
                `mutation CompanyProfileAddressSave($id:ID!,$address:CompanyAddressInput!,$types:[CompanyAddressType!]!) { companyLocationAssignAddress(locationId:$id,address:$address,addressTypes:$types) { addresses { countryCode } userErrors { message } } }`,
                {
                  address: toAddress(address, prior),
                  id: principal.businessUnitId,
                  types: [kind],
                }
              );
              yield* companyMutationResult(
                data,
                "companyLocationAssignAddress"
              );
            }
            return project(yield* read(principal.businessUnitId));
          }).pipe(Effect.mapError(uncertain));
        }),
    });
  })
);
export const companyProfilesLayer = companyProfilesLayerFromAdmin.pipe(
  Layer.provide(ShopifyCompanyAdmin.layer)
);
