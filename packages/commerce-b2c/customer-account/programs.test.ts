import { describe, expect, it } from "@effect/vitest";
import {
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
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

import { saveCustomerAddress, saveCustomerProfile } from "./programs";
import { CustomerAddressInput } from "./schema";

const authUserId = AuthUserId.make("authenticated-person");
const customerId = CommerceCustomerId.make("personal-customer");
const identity = { authUserId, email: Redacted.make("person@example.com") };
const profile = new CommerceCustomerProfile({ customerId });
const store = resolveStore({ locale: CommerceLocale.make("en-US") });
const principal = new B2CPurchasingPrincipal({ authUserId, customerId });
const input = Schema.decodeUnknownSync(CustomerAddressInput)({
  addressLine1: "100 Main Street",
  addressLine2: "",
  city: "New York",
  country: "US",
  postalCode: "10001",
  reference: "home",
  region: "NY",
});

describe("personal account", () => {
  it.effect(
    "uses the server identity and submitted names without company provisioning",
    () =>
      Effect.gen(function* () {
        const saved = yield* saveCustomerProfile(identity, {
          firstName: "Grace",
          lastName: "Hopper",
        });
        expect(saved).toEqual(profile);
      }).pipe(
        Effect.provide(
          Layer.succeed(
            CustomerProfiles,
            CustomerProfiles.of({
              save: (owner, names) => {
                expect(owner).toBe(identity);
                expect(Redacted.value(names.firstName)).toBe("Grace");
                expect(Redacted.value(names.lastName)).toBe("Hopper");
                return Effect.succeed(profile);
              },
            })
          )
        )
      )
  );

  it.effect(
    "requires personal authority before saving a personal address",
    () => {
      const context = Layer.succeed(
        CommerceContext,
        CommerceContext.of({
          customerPrincipal: () => Effect.succeed(principal),
          customerProfile: () => Effect.succeed(profile),
          principal: new AnonymousCommercePrincipal({}),
          store,
        })
      );
      const addresses = AddressBook.of({
        change: () => Effect.die("Address changes are not used in this test"),
        get: () => Effect.die("not used"),
        list: () => Effect.die("not used"),
        save: () => Effect.die("must reject before saving"),
      });
      return saveCustomerAddress(input).pipe(
        Effect.provide(
          Layer.merge(context, Layer.succeed(AddressBook, addresses))
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({ reason: "noBuyingContext" });
          return error;
        })
      );
    }
  );

  it("validates required address fields and country-specific regions", () => {
    expect(
      Schema.decodeUnknownOption(CustomerAddressInput)({ ...input, region: "" })
        ._tag
    ).toBe("None");
    expect(
      Schema.decodeUnknownOption(CustomerAddressInput)({
        ...input,
        country: "GB",
        region: "",
      })._tag
    ).toBe("Some");
    expect(
      Schema.decodeUnknownOption(CustomerAddressInput)({
        ...input,
        addressLine1: " ",
      })._tag
    ).toBe("None");
  });
});
