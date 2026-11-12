import { NextRequestApi } from "@repo/actions/next-request";
import { NextCommerce } from "@repo/commerce-b2c/bindings";
import {
  PURCHASING_CONTEXT_COOKIE_NAME,
  PURCHASING_CONTEXT_COOKIE_OPTIONS,
} from "@repo/commerce-core/commerce-context/purchasing-context-cookie";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";

import { customerIdentity } from "../customer-account/identity";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This program composer binds request provisioning after Customer enrollment; it constructs no service.
import { makeCustomerRegistrationProgram } from "./programs";
import type { CustomerRegistrationInput } from "./schema";

const registerCustomerProgram = makeCustomerRegistrationProgram({
  provideAddressBook: (request) => (program) =>
    program.pipe(NextCommerce.provideAddressBook(request)),
});

export const registerCustomer = Effect.fn("CustomerAccount.registerRequest")(
  function* (input: CustomerRegistrationInput, locale: Locale) {
    const identity = yield* customerIdentity;
    const store = resolveStore({ locale: CommerceLocale.make(locale) });
    yield* registerCustomerProgram(identity, input, store);
    const request = yield* NextRequestApi;
    const cookies = yield* request.getCookies();
    yield* Effect.sync(() => {
      cookies.set(
        PURCHASING_CONTEXT_COOKIE_NAME,
        "personal",
        PURCHASING_CONTEXT_COOKIE_OPTIONS
      );
    });
    return null;
  }
);
