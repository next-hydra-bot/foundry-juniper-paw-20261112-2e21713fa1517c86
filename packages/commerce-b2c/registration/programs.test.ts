import { describe, expect, it } from "@effect/vitest";
import {
  AddressBookEntry,
  AddressBookWriteOutcomeUnknown,
} from "@repo/commerce-core/domain/address-book";
import {
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import { AuthUserId } from "@repo/commerce-core/domain/commerce-request-context";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import {
  CommerceAccounts,
  CommerceCustomerEmailConflict,
} from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CustomerProfiles } from "@repo/commerce-core/services/customer-profiles";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Redacted, Schema } from "effect";

import { b2cPurchasingContextLayer } from "../commerce-context";
import { makeCustomerRegistrationProgram } from "./programs";
import { CustomerRegistrationInput } from "./schema";

const identity = {
  authUserId: AuthUserId.make("authenticated-person"),
  email: Redacted.make("person@example.com"),
};
const profile = new CommerceCustomerProfile({
  customerId: CommerceCustomerId.make("personal-customer"),
});
const store = resolveStore({ locale: CommerceLocale.make("en-US") });
const input = Schema.decodeSync(CustomerRegistrationInput)({
  addressLine1: "100 Main Street",
  addressLine2: "",
  city: "New York",
  country: "US",
  firstName: "Grace",
  lastName: "Hopper",
  postalCode: "10001",
  reference: "home",
  region: "NY",
});

const registrationFixture = (options?: {
  readonly emailConflict?: boolean;
  readonly unknownAddressOutcome?: boolean;
}) => {
  const calls: string[] = [];
  let enrolled = false;
  let failAddress = options?.unknownAddressOutcome === true;
  const accounts = Layer.effect(
    CommerceAccounts,
    Effect.gen(function* () {
      const memory = yield* CommerceAccounts;
      return CommerceAccounts.of({
        ...memory,
        getCustomerIdByAuthUserId: (authUserId) =>
          Effect.gen(function* () {
            calls.push("resolveContext");
            expect(authUserId).toBe(identity.authUserId);
            return enrolled
              ? profile.customerId
              : yield* memory.getCustomerIdByAuthUserId(authUserId);
          }),
      });
    })
  ).pipe(Layer.provide(CommerceAccounts.layerMemory));
  const profiles = Layer.succeed(
    CustomerProfiles,
    CustomerProfiles.of({
      save: (owner, names) =>
        Effect.gen(function* () {
          calls.push("saveProfile");
          expect(owner).toBe(identity);
          expect(Redacted.value(names.firstName)).toBe(input.firstName);
          expect(Redacted.value(names.lastName)).toBe(input.lastName);
          if (options?.emailConflict) {
            return yield* new CommerceCustomerEmailConflict({
              message: "Customer belongs to another identity",
            });
          }
          enrolled = true;
          return profile;
        }),
    })
  );
  const addresses = Layer.effect(
    AddressBook,
    Effect.gen(function* () {
      const context = yield* CommerceContext;
      return AddressBook.of({
        change: () => Effect.die("Address changes are not used in this test"),
        get: () => Effect.die("not used"),
        list: () => Effect.die("not used"),
        save: (address) =>
          Effect.gen(function* () {
            calls.push(`saveAddress:${address.reference}`);
            expect(context.principal).toMatchObject({
              _tag: "B2CPurchasingPrincipal",
              authUserId: identity.authUserId,
              customerId: profile.customerId,
            });
            expect(context.store).toEqual(store);
            expect(address.address).toEqual({
              addressLine1: input.addressLine1,
              city: input.city,
              country: input.country,
              postalCode: input.postalCode,
              region: input.region,
            });
            expect(address.types).toEqual(["shipping", "billing"]);
            if (failAddress) {
              failAddress = false;
              return yield* new AddressBookWriteOutcomeUnknown({
                message: "Address write could not be confirmed",
                reference: address.reference,
              });
            }
            return new AddressBookEntry(address);
          }),
      });
    })
  );
  const register = makeCustomerRegistrationProgram({
    provideAddressBook: (request) =>
      Effect.provide(
        addresses.pipe(Layer.provideMerge(b2cPurchasingContextLayer(request)))
      ),
  });
  return { calls, layer: Layer.merge(accounts, profiles), register };
};

describe("personal registration", () => {
  it.effect(
    "creates the Customer before resolving its address-book context",
    () => {
      const fixture = registrationFixture();
      return Effect.gen(function* () {
        expect(yield* fixture.register(identity, input, store)).toEqual(
          profile
        );
        expect(fixture.calls).toEqual([
          "saveProfile",
          "resolveContext",
          "saveAddress:home",
        ]);
      }).pipe(Effect.provide(fixture.layer));
    }
  );

  it.effect(
    "stops before context resolution when Customer enrollment fails",
    () => {
      const fixture = registrationFixture({ emailConflict: true });
      return Effect.gen(function* () {
        const error = yield* fixture
          .register(identity, input, store)
          .pipe(Effect.flip);
        expect(error._tag).toBe("CommerceCustomerEmailConflict");
        expect(fixture.calls).toEqual(["saveProfile"]);
      }).pipe(Effect.provide(fixture.layer));
    }
  );

  it.effect(
    "preserves an unknown address outcome and its reference on retry",
    () => {
      const fixture = registrationFixture({ unknownAddressOutcome: true });
      return Effect.gen(function* () {
        const error = yield* fixture
          .register(identity, input, store)
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "AddressBookWriteOutcomeUnknown",
          reference: input.reference,
        });
        expect(yield* fixture.register(identity, input, store)).toEqual(
          profile
        );
        expect(fixture.calls).toEqual([
          "saveProfile",
          "resolveContext",
          "saveAddress:home",
          "saveProfile",
          "resolveContext",
          "saveAddress:home",
        ]);
      }).pipe(Effect.provide(fixture.layer));
    }
  );
});
