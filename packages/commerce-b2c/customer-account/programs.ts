import { SaveAddressBookEntryInput } from "@repo/commerce-core/domain/address-book";
import { CommerceRequestContextNotFound } from "@repo/commerce-core/domain/commerce-request-context";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CustomerProfiles } from "@repo/commerce-core/services/customer-profiles";
import type { CustomerProfileIdentity } from "@repo/commerce-core/services/customer-profiles";
import { Effect, Redacted } from "effect";

import type { CustomerAddressInput, CustomerProfileInput } from "./schema";

export const customerPostalAddress = (input: CustomerAddressInput) => ({
  addressLine1: input.addressLine1,
  addressLine2: input.addressLine2 || undefined,
  city: input.city,
  country: input.country,
  postalCode: input.postalCode,
  region: input.region || undefined,
});

export const saveCustomerProfile = Effect.fn("CustomerAccount.saveProfile")(
  function* (identity: CustomerProfileIdentity, input: CustomerProfileInput) {
    const profiles = yield* CustomerProfiles;
    return yield* profiles.save(identity, {
      firstName: Redacted.make(input.firstName, { label: "personName" }),
      lastName: Redacted.make(input.lastName, { label: "personName" }),
    });
  }
);

export const saveCustomerAddress = Effect.fn("CustomerAccount.saveAddress")(
  function* (input: CustomerAddressInput) {
    const context = yield* CommerceContext;
    if (context.principal._tag !== "B2CPurchasingPrincipal") {
      return yield* new CommerceRequestContextNotFound({
        message: "Personal addresses require personal purchasing",
        reason: "noBuyingContext",
      });
    }
    return yield* AddressBook.save(
      new SaveAddressBookEntryInput({
        address: customerPostalAddress(input),
        defaultBilling: false,
        defaultShipping: false,
        reference: input.reference,
        types: ["shipping", "billing"],
      })
    );
  }
);
