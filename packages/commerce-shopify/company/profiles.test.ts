import { describe, expect, it } from "@effect/vitest";
import { CountryCode } from "@repo/commerce-core/domain/address";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CompanyProfiles } from "@repo/commerce-core/services/company-profiles";
import { Effect, Layer, Schema } from "effect";
import {
  buildSchema,
  parse,
  validate,
  getOperationAST,
  getVariableValues,
} from "graphql";

import { ShopifyCompanyAdmin } from "./admin";
import { companyProfilesLayerFromAdmin } from "./profiles";

const principal = new CustomerCommercePrincipal({
  authUserId: AuthUserId.make("user-1"),
  businessUnitId: CommerceBusinessUnitId.make(
    "gid://shopify/CompanyLocation/1"
  ),
  businessUnitKey: CommerceBusinessUnitKey.make(
    "gid://shopify/CompanyLocation/1"
  ),
  customerId: CommerceCustomerId.make("gid://shopify/Customer/1"),
  roles: ["buyer"],
});
const address = {
  addressLine1: "1 Main Street",
  addressLine2: "",
  city: "London",
  country: CountryCode.make("GB"),
  postalCode: "SW1A 1AA",
  region: "",
};
const NativeAddress = Schema.Struct({
  address1: Schema.String,
  address2: Schema.NullOr(Schema.String),
  city: Schema.String,
  countryCode: Schema.String,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  phone: Schema.NullOr(Schema.String),
  recipient: Schema.NullOr(Schema.String),
  zip: Schema.String,
  zoneCode: Schema.NullOr(Schema.String),
});
const nativeAddress: typeof NativeAddress.Type = {
  address1: "1 Main Street",
  address2: null,
  city: "London",
  countryCode: "GB",
  firstName: "Contact",
  lastName: "Buyer",
  phone: "+442012345678",
  recipient: "Reception",
  zip: "SW1A 1AA",
  zoneCode: null,
};
// Admin schema excerpt from Shopify 2026-10: creation and update inputs are
// intentionally distinct, and address changes have their own mutation.
const schema = buildSchema(`
  enum CountryCode { GB US }
  enum CompanyAddressType { SHIPPING BILLING }
  input CompanyAddressInput { address1:String address2:String city:String countryCode:CountryCode firstName:String lastName:String phone:String recipient:String zip:String zoneCode:String }
  input CompanyLocationInput { name:String phone:String shippingAddress:CompanyAddressInput billingAddress:CompanyAddressInput billingSameAsShipping:Boolean }
  input CompanyLocationUpdateInput { name:String phone:String externalId:String locale:String note:String }
  type CompanyAddress { address1:String! address2:String city:String countryCode:CountryCode! firstName:String lastName:String phone:String recipient:String zip:String zoneCode:String }
  type Company { id:ID! name:String! }
  type CompanyLocation { id:ID! name:String! phone:String updatedAt:String! company:Company! shippingAddress:CompanyAddress billingAddress:CompanyAddress }
  type UserError { message:String! }
  type LocationUpdatePayload { companyLocation:CompanyLocation userErrors:[UserError!]! }
  type AddressUpdatePayload { addresses:[CompanyAddress!] userErrors:[UserError!]! }
  type Query { companyLocation(id:ID!):CompanyLocation }
  type Mutation {
    companyLocationUpdate(companyLocationId:ID!,input:CompanyLocationUpdateInput!):LocationUpdatePayload
    companyLocationAssignAddress(locationId:ID!,address:CompanyAddressInput!,addressTypes:[CompanyAddressType!]!):AddressUpdatePayload
  }
`);
const fixture = () => {
  type NativeLocation = {
    id: string;
    name: string;
    phone: string | null;
    updatedAt: string;
    company: { id: string; name: string };
    shippingAddress: typeof NativeAddress.Type;
    billingAddress: typeof NativeAddress.Type;
  };
  let location: NativeLocation = {
    billingAddress: nativeAddress,
    company: { id: "gid://shopify/Company/1", name: "Equipment" },
    id: principal.businessUnitId,
    name: "Warehouse",
    phone: "+442012345678",
    shippingAddress: nativeAddress,
    updatedAt: "2026-10-24T00:00:00Z",
  };
  let writes = 0;
  let loseAt: number | undefined;
  const fetchApi: typeof fetch = async (_url, init) => {
    const bodyText = await new Response(init?.body).text();
    const body = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({ query: Schema.String, variables: Schema.Json })
      )
    )(bodyText);
    const document = parse(body.query);
    expect(validate(schema, document)).toEqual([]);
    const operation = getOperationAST(document);
    if (!operation) {
      throw new Error("Missing operation");
    }
    const coerced = getVariableValues(
      schema,
      operation.variableDefinitions ?? [],
      Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
        body.variables
      )
    );
    expect(coerced.errors).toBeUndefined();
    if (body.query.includes("CompanyProfileSave")) {
      const variables = Schema.decodeUnknownSync(
        Schema.Struct({
          input: Schema.Struct({
            name: Schema.String,
            phone: Schema.NullOr(Schema.String),
          }),
        })
      )(body.variables);
      writes += 1;
      location = {
        ...location,
        ...variables.input,
        updatedAt: "2026-10-24T00:01:00Z",
      };
      if (loseAt === writes) {
        throw new Error("Response lost after commit");
      }
      return Response.json({
        data: {
          companyLocationUpdate: {
            companyLocation: { id: location.id },
            userErrors: [],
          },
        },
      });
    }
    if (body.query.includes("CompanyProfileAddressSave")) {
      const variables = Schema.decodeUnknownSync(
        Schema.Struct({
          address: NativeAddress,
          types: Schema.Array(Schema.Literals(["SHIPPING", "BILLING"])),
        })
      )(body.variables);
      expect(variables.address).toMatchObject({
        firstName: "Contact",
        phone: "+442012345678",
        recipient: "Reception",
      });
      writes += 1;
      location = {
        ...location,
        ...(variables.types.includes("SHIPPING")
          ? { shippingAddress: variables.address }
          : { billingAddress: variables.address }),
      };
      if (loseAt === writes) {
        throw new Error("Response lost after commit");
      }
      return Response.json({
        data: {
          companyLocationAssignAddress: {
            addresses: [variables.address],
            userErrors: [],
          },
        },
      });
    }
    return await Promise.resolve(
      Response.json({ data: { companyLocation: location } })
    );
  };
  return {
    change: () => {
      location = { ...location, name: "Changed elsewhere" };
    },
    layer: companyProfilesLayerFromAdmin.pipe(
      Layer.provide(
        ShopifyCompanyAdmin.layerWith(
          {
            SHOPIFY_ADMIN_ACCESS_TOKEN: "test",
            SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
          },
          fetchApi
        )
      )
    ),
    lose: (step = 1) => {
      loseAt = step;
    },
    native: () => location,
    writes: () => writes,
  };
};

describe("Shopify company profiles", () => {
  it.effect(
    "updates the selected location and its native address slots without renaming the company",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const profiles = yield* CompanyProfiles;
          const current = yield* profiles.get(principal);
          const saved = yield* profiles.save(principal, {
            billingAddress: { ...address, addressLine1: "2 Billing Road" },
            name: "New warehouse",
            phone: "+442012345678",
            revision: current.revision,
            shippingAddress: address,
          });
          expect([
            saved.name,
            saved.companyName,
            saved.billingAddress?.addressLine1,
            saved.shippingAddress?.country,
          ]).toEqual(["New warehouse", "Equipment", "2 Billing Road", "GB"]);
          expect(saved.revision).not.toBe(current.revision);
          expect(source.writes()).toBe(3);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect(
    "rejects stale forms and cross-location revisions before mutation",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const profiles = yield* CompanyProfiles;
          const current = yield* profiles.get(principal);
          const input = {
            billingAddress: address,
            name: "Edit",
            phone: "",
            revision: current.revision,
            shippingAddress: address,
          };
          source.change();
          expect(
            (yield* profiles.save(principal, input).pipe(Effect.flip))._tag
          ).toBe("CompanyProfileChanged");
          expect(
            (yield* profiles
              .get(
                new CustomerCommercePrincipal({
                  authUserId: principal.authUserId,
                  businessUnitId: CommerceBusinessUnitId.make(
                    "gid://shopify/CompanyLocation/2"
                  ),
                  businessUnitKey: principal.businessUnitKey,
                  customerId: principal.customerId,
                  roles: principal.roles,
                })
              )
              .pipe(Effect.flip))._tag
          ).toBe("CompanyProfileUnavailable");
          expect(source.writes()).toBe(0);
        }).pipe(Effect.provide(source.layer));
      })
  );
  it.effect("does not replay a save whose response was lost after commit", () =>
    Effect.gen(function* () {
      const source = fixture();
      yield* Effect.gen(function* () {
        const profiles = yield* CompanyProfiles;
        const current = yield* profiles.get(principal);
        source.lose();
        const result = yield* profiles
          .save(principal, {
            billingAddress: address,
            name: "Committed",
            phone: "",
            revision: current.revision,
            shippingAddress: address,
          })
          .pipe(Effect.flip);
        expect(result._tag).toBe("CompanyProfileWriteOutcomeUnknown");
        expect((yield* profiles.get(principal)).name).toBe("Committed");
        expect(source.writes()).toBe(1);
      }).pipe(Effect.provide(source.layer));
    })
  );
});

it.effect(
  "requires refresh when an address commits before a later response is lost",
  () =>
    Effect.gen(function* () {
      const source = fixture();
      yield* Effect.gen(function* () {
        const profiles = yield* CompanyProfiles;
        const current = yield* profiles.get(principal);
        source.lose(2);
        const error = yield* profiles
          .save(principal, {
            billingAddress: { ...address, addressLine1: "30 Birch St" },
            name: "Edited",
            phone: "",
            revision: current.revision,
            shippingAddress: { ...address, addressLine1: "20 Oak St" },
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("CompanyProfileWriteOutcomeUnknown");
        expect(source.native().shippingAddress.address1).toBe("20 Oak St");
        expect(source.native().billingAddress.address1).toBe("1 Main Street");
        expect(source.writes()).toBe(2);
      }).pipe(Effect.provide(source.layer));
    })
);
