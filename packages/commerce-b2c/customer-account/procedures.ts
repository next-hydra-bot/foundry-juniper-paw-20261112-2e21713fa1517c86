import { NextCommerce } from "@repo/commerce-b2c/bindings";
import {
  customerPostalAddress,
  saveCustomerAddress,
  saveCustomerProfile,
} from "@repo/commerce-b2c/customer-account/programs";
import type {
  CustomerAddressChangeInput,
  CustomerAddressInput,
  CustomerProfileInput,
} from "@repo/commerce-b2c/customer-account/schema";
import { B2CPurchasingContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { CustomerProfileIdentity } from "@repo/commerce-core/services/customer-profiles";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";

import { customerIdentity } from "./identity";

export const provideB2CPurchasingContext = <A, E>(
  program: Effect.Effect<A, E, AddressBook | CommerceContext>,
  locale: Locale,
  identity: CustomerProfileIdentity
) =>
  program.pipe(
    NextCommerce.provideAddressBook(
      new B2CPurchasingContextRequest({
        authUserId: identity.authUserId,
        store: resolveStore({ locale: CommerceLocale.make(locale) }),
      })
    )
  );

export const updateCustomerProfile = Effect.fn("CustomerAccount.updateProfile")(
  function* (input: CustomerProfileInput) {
    const identity = yield* customerIdentity;
    yield* saveCustomerProfile(identity, input);
    return null;
  }
);

export const addCustomerAddress = Effect.fn("CustomerAccount.addAddress")(
  function* (input: CustomerAddressInput, locale: Locale) {
    const identity = yield* customerIdentity;
    yield* provideB2CPurchasingContext(
      saveCustomerAddress(input),
      locale,
      identity
    );
    return null;
  }
);

export const changeCustomerAddress = Effect.fn("CustomerAccount.changeAddress")(
  function* (input: CustomerAddressChangeInput, locale: Locale) {
    const identity = yield* customerIdentity;
    const change =
      input.operation === "edit"
        ? { address: customerPostalAddress(input), operation: input.operation }
        : { operation: input.operation };
    yield* provideB2CPurchasingContext(
      AddressBook.change(input.reference, change),
      locale,
      identity
    );
    return null;
  }
);
