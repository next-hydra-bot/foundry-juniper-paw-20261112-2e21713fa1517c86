import { describe, expect, it } from "@effect/vitest";
import { CountryCode } from "@repo/commerce-core/domain/address";
import {
  AddressBookReference,
  SaveAddressBookEntryInput,
} from "@repo/commerce-core/domain/address-book";
import { CommerceCustomerId } from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  B2CPurchasingPrincipal,
  AnonymousCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CustomerProfiles } from "@repo/commerce-core/services/customer-profiles";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Redacted, Schema } from "effect";

import { ShopifyCustomerAccounts } from "./accounts";
import { customerAddressBookLayerWith } from "./address-book";
import { customerProfilesLayerWith } from "./profiles";

const environment = {
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: "client",
  SHOPIFY_SHOP_ID: "123",
  SHOPIFY_CUSTOMER_SESSION_SECRET: "secret-at-least-thirty-two-characters",
  SHOPIFY_STOREFRONT_ORIGIN: "https://store.example",
};
const NativeAddress = Schema.Struct({
  id: Schema.String,
  address1: Schema.NullOr(Schema.String),
  address2: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  countryCode: Schema.NullOr(Schema.String),
  zip: Schema.NullOr(Schema.String),
  zoneCode: Schema.NullOr(Schema.String),
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  phoneNumber: Schema.NullOr(Schema.String),
});
const nativeAddress = (id: number): typeof NativeAddress.Type => ({
  id: `gid://shopify/CustomerAddress/${id}`,
  address1: `${id} Main Street`,
  address2: "Suite 2",
  city: "New York",
  countryCode: "US",
  zip: "10001",
  zoneCode: "NY",
  firstName: "Native recipient",
  lastName: "Buyer",
  company: "Recipient company",
  phoneNumber: "+12125550123",
});
const principal = new B2CPurchasingPrincipal({
  authUserId: AuthUserId.make("site-user"),
  customerId: CommerceCustomerId.make("gid://shopify/Customer/1"),
});
const save = (
  reference = "new-address",
  options: {
    readonly defaultShipping?: boolean;
    readonly country?: CountryCode;
    readonly region?: string;
  } = {}
) =>
  new SaveAddressBookEntryInput({
    reference: AddressBookReference.make(reference),
    address: {
      addressLine1: "20 Oak Street",
      addressLine2: "Unit 4",
      city: "New York",
      country: options.country ?? CountryCode.make("US"),
      postalCode: "10002",
      region: options.region ?? "NY",
    },
    types: ["shipping", "billing"],
    defaultShipping: options.defaultShipping ?? false,
    defaultBilling: false,
  });
const fixture = (
  anonymous = false,
  initialAddresses: readonly (typeof NativeAddress.Type)[] = [
    nativeAddress(1),
    nativeAddress(2),
  ]
) => {
  let customerId = String(principal.customerId);
  let firstName = "Original";
  let lastName = "Buyer";
  let cached = {
    email: "buyer@example.com",
    id: String(principal.customerId),
    firstName,
    lastName,
  };
  let addresses = [...initialAddresses];
  let defaultId = addresses[0]?.id;
  let lostWrite = false;
  let rejected = false;
  let readFailure = false;
  let failAfterWrite = false;
  let repeatCursor = false;
  const writes: {
    readonly query: string;
    readonly variables: Readonly<Record<string, Schema.Json>>;
  }[] = [];
  const reads: Readonly<Record<string, Schema.Json>>[] = [];
  const fetchApi: typeof fetch = async (_url, init) => {
    const request = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({
          query: Schema.String,
          variables: Schema.Record(Schema.String, Schema.Json),
        })
      )
    )(await new Response(init?.body).text());
    if (request.query.includes("CustomerSavedAddresses")) {
      reads.push(request.variables);
      const { after } = Schema.decodeUnknownSync(
        Schema.Struct({ after: Schema.NullOr(Schema.String) })
      )(request.variables);
      if (readFailure) {
        return Response.json({ errors: [{ message: "private native error" }] });
      }
      return Response.json({
        data: {
          customer: {
            id: customerId,
            defaultAddress: defaultId === undefined ? null : { id: defaultId },
            addresses: {
              nodes: after ? addresses.slice(1) : addresses.slice(0, 1),
              pageInfo: {
                hasNextPage:
                  repeatCursor || (after === null && addresses.length > 1),
                endCursor: "second-page",
              },
            },
          },
        },
      });
    }
    writes.push(request);
    if (request.query.includes("CustomerProfileSave")) {
      const names = Schema.decodeUnknownSync(
        Schema.Struct({ firstName: Schema.String, lastName: Schema.String })
      )(request.variables.input);
      ({ firstName, lastName } = names);
      return Response.json({
        data: {
          customerUpdate: { customer: { id: customerId }, userErrors: [] },
        },
      });
    }
    if (rejected) {
      return Response.json({
        data: {
          saved: {
            customerAddress: null,
            userErrors: [{ message: "private address diagnostic" }],
          },
        },
      });
    }
    const variables = Schema.decodeUnknownSync(
      Schema.Struct({
        id: Schema.optionalKey(Schema.String),
        defaultAddress: Schema.Boolean,
      })
    )(request.variables);
    const id =
      variables.id ?? `gid://shopify/CustomerAddress/${addresses.length + 1}`;
    const address = Schema.decodeUnknownSync(NativeAddress)({
      ...Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
        request.variables.address
      ),
      id,
    });
    addresses = [...addresses.filter((item) => item.id !== id), address];
    if (variables.defaultAddress || defaultId === undefined) {
      defaultId = id;
    }
    if (failAfterWrite) {
      readFailure = true;
    }
    if (lostWrite) {
      throw new Error("connection lost after commit");
    }
    return Response.json({
      data: { saved: { customerAddress: { id }, userErrors: [] } },
    });
  };
  const sessions = Layer.succeed(
    ShopifyCustomerAccounts,
    ShopifyCustomerAccounts.of({
      profile: Effect.sync(() => ({ ...cached, firstName, lastName })),
      read: Effect.sync(() => ({
        authUserId: "site-user",
        scope: "test",
        customer: cached,
        accessToken: Redacted.make("token"),
        cartSynchronizationPending: false,
      })),
      cartAccessToken: Effect.succeed(Redacted.make("token")),
      completeCartSynchronization: Effect.void,
      refreshProfile: Effect.sync(() => {
        cached = { ...cached, firstName, lastName };
        return cached;
      }),
      handle: () => Effect.die("Authentication is exercised by session tests"),
      accountDestination: () => Effect.succeed(undefined),
      checkoutDestination: () => Effect.succeed(undefined),
    })
  );
  const context = Layer.succeed(
    CommerceContext,
    CommerceContext.of({
      principal: anonymous ? new AnonymousCommercePrincipal({}) : principal,
      store: resolveStore({ locale: CommerceLocale.make("en-US") }),
      customerPrincipal: () => Effect.succeed(principal),
      customerProfile: () => Effect.die("Not used by this adapter"),
    })
  );
  const layer = Layer.mergeAll(
    customerProfilesLayerWith({ environment, fetchApi }).pipe(
      Layer.provide(sessions)
    ),
    customerAddressBookLayerWith({ environment, fetchApi }).pipe(
      Layer.provide(Layer.merge(sessions, context))
    )
  );
  return {
    layer,
    writes,
    reads,
    loseWrite: () => {
      lostWrite = true;
    },
    rejectWrite: () => {
      rejected = true;
    },
    loseFinalRead: () => {
      failAfterWrite = true;
    },
    repeatCursor: () => {
      repeatCursor = true;
    },
    anotherCustomer: () => {
      customerId = "gid://shopify/Customer/2";
    },
  };
};

describe("Shopify customer account management", () => {
  it.effect(
    "edits the connected customer's names without sending a submitted identity or changing email",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const profiles = yield* CustomerProfiles;
        const profile = yield* profiles.save(
          {
            authUserId: principal.authUserId,
            email: Redacted.make("buyer@example.com"),
          },
          { firstName: Redacted.make("New"), lastName: Redacted.make("Name") }
        );
        expect(
          profile.firstName === undefined
            ? undefined
            : Redacted.value(profile.firstName)
        ).toBe("New");
        expect(f.writes[0]?.variables).toEqual({
          input: { firstName: "New", lastName: "Name" },
        });
        const rejected = yield* profiles
          .save(
            {
              authUserId: AuthUserId.make("someone-else"),
              email: Redacted.make("buyer@example.com"),
            },
            {
              firstName: Redacted.make("Wrong"),
              lastName: Redacted.make("Name"),
            }
          )
          .pipe(Effect.flip);
        expect(rejected._tag).toBe("CommerceAccountUnavailable");
        expect(f.writes).toHaveLength(1);
      }).pipe(Effect.provide(f.layer));
    }
  );
  it.effect(
    "paginates native addresses and updates only an exact owned reference, preserving recipients",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const all = yield* AddressBook.list();
        expect(all).toMatchObject([
          {
            defaultBilling: true,
            defaultShipping: true,
            types: ["shipping", "billing"],
          },
          {},
        ]);
        expect(f.reads[1]).toEqual({ after: "second-page" });
        const [, second] = all;
        if (!second) {
          return yield* Effect.die("Fixture address is missing");
        }
        const updated = yield* AddressBook.save(save(second.reference));
        expect(updated.reference).toBe(second.reference);
        expect(f.writes[0]?.variables).toMatchObject({
          id: "gid://shopify/CustomerAddress/2",
          address: {
            address1: "20 Oak Street",
            firstName: "Native recipient",
            phoneNumber: "+12125550123",
          },
        });
        expect(yield* AddressBook.get(second.reference)).toEqual(updated);
      }).pipe(Effect.provide(f.layer));
    }
  );
  it.effect(
    "creates a native address with the full street line and returns its native reference",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const created = yield* AddressBook.save(save());
        expect(created.reference).not.toBe("new-address");
        expect(created.address.addressLine1).toBe("20 Oak Street");
        expect(f.writes).toHaveLength(1);
        expect(f.writes[0]?.variables.address).not.toHaveProperty(
          "streetNumber"
        );
      }).pipe(Effect.provide(f.layer));
    }
  );
  it.effect(
    "reads saved addresses with missing postal and street details",
    () => {
      const f = fixture(false, [
        {
          ...nativeAddress(1),
          address1: null,
          city: null,
          zip: null,
          countryCode: null,
        },
      ]);
      return Effect.gen(function* () {
        const entries = yield* AddressBook.list();
        expect(entries).toHaveLength(1);
        expect(entries[0]?.address).toMatchObject({
          addressLine1: "",
          city: "",
          postalCode: "",
        });
        expect(entries[0]?.address.country).toBeUndefined();
        expect(entries[0]?.defaultShipping).toBeTruthy();
      }).pipe(Effect.provide(f.layer));
    }
  );

  for (const [country, region, code] of [
    ["US", "New York", "NY"],
    ["CA", "Ontario", "ON"],
    ["CA", "Québec", "QC"],
  ] as const) {
    it.effect(`sends the native region code for ${region}`, () => {
      const f = fixture();
      return Effect.gen(function* () {
        yield* AddressBook.save(
          save(undefined, { country: CountryCode.make(country), region })
        );
        expect(f.writes[0]?.variables.address).toMatchObject({
          countryCode: country,
          zoneCode: code,
        });
      }).pipe(Effect.provide(f.layer));
    });
  }

  it.effect(
    "creates the first saved address and returns its native default selection",
    () => {
      const f = fixture(false, []);
      return Effect.gen(function* () {
        expect(yield* AddressBook.list()).toEqual([]);
        const created = yield* AddressBook.save(save());
        expect(created.address.addressLine1).toBe("20 Oak Street");
        expect(created).toMatchObject({
          defaultBilling: true,
          defaultShipping: true,
        });
        expect(yield* AddressBook.get(created.reference)).toEqual(created);
        expect(f.writes).toHaveLength(1);
      }).pipe(Effect.provide(f.layer));
    }
  );

  for (const failure of ["loseWrite", "loseFinalRead"] as const) {
    it.effect(
      `requires refresh after ${failure}, without repeating the native create`,
      () => {
        const f = fixture();
        f[failure]();
        return Effect.gen(function* () {
          const error = yield* AddressBook.save(save()).pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "AddressBookWriteOutcomeUnknown",
            reference: "new-address",
          });
          expect(f.writes).toHaveLength(1);
          if (failure === "loseWrite") {
            expect(yield* AddressBook.list()).toHaveLength(3);
          }
        }).pipe(Effect.provide(f.layer));
      }
    );
  }
  it.effect(
    "keeps a confirmed native validation rejection distinct from an uncertain save",
    () => {
      const f = fixture();
      f.rejectWrite();
      return Effect.gen(function* () {
        const error = yield* AddressBook.save(save()).pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "AddressBookMutationRejected",
          recovery: "fix_input",
        });
        expect(JSON.stringify(error)).not.toContain(
          "private address diagnostic"
        );
      }).pipe(Effect.provide(f.layer));
    }
  );
  it.effect(
    "rejects unowned references, unsupported defaults and countries before writing",
    () => {
      const f = fixture();
      return Effect.gen(function* () {
        const foreign = `shopify_${Buffer.from("gid://shopify/CustomerAddress/99").toString("base64url")}`;
        expect(
          (yield* AddressBook.save(save(foreign)).pipe(Effect.flip))._tag
        ).toBe("AddressBookAccessDenied");
        const [existingDefault] = yield* AddressBook.list();
        if (!existingDefault) {
          return yield* Effect.die("Fixture default address is missing");
        }
        expect(
          (yield* AddressBook.save(save(existingDefault.reference)).pipe(
            Effect.flip
          ))._tag
        ).toBe("AddressBookMutationRejected");
        expect(
          (yield* AddressBook.save(
            save(undefined, { defaultShipping: true })
          ).pipe(Effect.flip))._tag
        ).toBe("AddressBookMutationRejected");
        expect(
          (yield* AddressBook.save(
            save(undefined, { country: CountryCode.make("AQ") })
          ).pipe(Effect.flip))._tag
        ).toBe("AddressBookMutationRejected");
        expect(f.writes).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    }
  );
  it.effect(
    "does not expose customer addresses through guest authority",
    () => {
      const f = fixture(true);
      return Effect.gen(function* () {
        expect((yield* AddressBook.list().pipe(Effect.flip))._tag).toBe(
          "AddressBookAccessDenied"
        );
        expect(f.reads).toEqual([]);
      }).pipe(Effect.provide(f.layer));
    }
  );
  for (const mismatch of ["anotherCustomer", "repeatCursor"] as const) {
    it.effect(
      `fails a native ${mismatch} instead of returning another or incomplete address book`,
      () => {
        const f = fixture();
        f[mismatch]();
        return Effect.gen(function* () {
          const error = yield* AddressBook.list().pipe(Effect.flip);
          expect(error._tag).toBe(
            mismatch === "anotherCustomer"
              ? "AddressBookAccessDenied"
              : "AddressBookProviderFailure"
          );
        }).pipe(Effect.provide(f.layer));
      }
    );
  }
});
