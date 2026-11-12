import type { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import { B2CPurchasingContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { AddressBookSaveFailure } from "@repo/commerce-core/services/address-book";
import type { CustomerProfileIdentity } from "@repo/commerce-core/services/customer-profiles";
import type { Store } from "@repo/commerce-core/store";
import { Effect } from "effect";

import {
  saveCustomerAddress,
  saveCustomerProfile,
} from "../customer-account/programs";
import type { CustomerRegistrationInput } from "./schema";

export interface CustomerRegistrationBindings<ProvisionError, Services> {
  readonly provideAddressBook: (
    request: B2CPurchasingContextRequest
  ) => (
    program: ReturnType<typeof saveCustomerAddress>
  ) => Effect.Effect<
    AddressBookEntry,
    AddressBookSaveFailure | ProvisionError,
    Services
  >;
}

/** The host binds request services; registration resolves them after enrollment. */
export const makeCustomerRegistrationProgram = <ProvisionError, Services>(
  bindings: CustomerRegistrationBindings<ProvisionError, Services>
) =>
  Effect.fn("CustomerAccount.register")(function* (
    identity: CustomerProfileIdentity,
    input: CustomerRegistrationInput,
    store: Store
  ) {
    const profile = yield* saveCustomerProfile(identity, input);
    yield* saveCustomerAddress(input).pipe(
      bindings.provideAddressBook(
        new B2CPurchasingContextRequest({
          authUserId: identity.authUserId,
          store,
        })
      )
    );
    return profile;
  });
