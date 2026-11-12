import { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { definePublicError } from "@repo/errors";
import { Effect, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";

import { CommerceRequestHeaders } from "./commerce-request";

const AddressBookApiForbiddenDefinition = definePublicError({
  category: "forbidden",
  code: "addressBook.accessDenied",
  fields: {},
  recovery: "request_access",
  status: 403,
  tag: "AddressBookApiForbidden",
});
export const AddressBookApiForbidden = AddressBookApiForbiddenDefinition.schema;
export type AddressBookApiForbidden = typeof AddressBookApiForbidden.Type;
export const makeAddressBookApiForbidden =
  AddressBookApiForbiddenDefinition.make;

const AddressBookContextUnavailableDefinition = definePublicError({
  category: "not_found",
  code: "addressBook.contextUnavailable",
  fields: {
    reason: Schema.Literals([
      "noPrincipal",
      "noCustomerMapping",
      "noBuyingContext",
    ]),
  },
  recovery: "refresh",
  status: 404,
  tag: "CommerceRequestContextNotFound",
});
export const AddressBookContextUnavailable =
  AddressBookContextUnavailableDefinition.schema;
export type AddressBookContextUnavailable =
  typeof AddressBookContextUnavailable.Type;
export const makeAddressBookContextUnavailable =
  AddressBookContextUnavailableDefinition.make;

const AddressBookApiErrorDefinition = definePublicError({
  category: "unavailable",
  code: "addressBook.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "AddressBookApiError",
});
export const AddressBookApiError = AddressBookApiErrorDefinition.schema;
export type AddressBookApiError = typeof AddressBookApiError.Type;
export const makeAddressBookApiError = AddressBookApiErrorDefinition.make;

export const addressBookHttpPrograms = {
  list: AddressBook.list().pipe(
    Effect.catchTags({
      AddressBookAccessDenied: () =>
        Effect.fail(
          makeAddressBookApiForbidden({
            message: "Address book access is denied.",
          })
        ),
      AddressBookProviderFailure: (error) =>
        error.reason === "unavailable"
          ? Effect.logError("Address Book provider request failed", error).pipe(
              Effect.annotateLogs({ "addressBook.operation": error.operation }),
              Effect.andThen(
                Effect.fail(
                  makeAddressBookApiError({
                    message: "The address book is temporarily unavailable.",
                  })
                )
              )
            )
          : Effect.die(error),
      CommerceRequestContextNotFound: ({ reason }) =>
        Effect.fail(
          makeAddressBookContextUnavailable({
            reason,
            message: "The selected customer or company context is unavailable.",
          })
        ),
    })
  ),
};

/** Hosts authenticate the caller and provide the selected customer's or company's Address Book. */
export const makeAddressBookApiGroup = <Headers extends Schema.Top>(
  headers: Headers
) =>
  HttpApiGroup.make("addressBook").add(
    HttpApiEndpoint.get("list", "/address-book", {
      headers,
      success: Schema.Array(AddressBookEntry),
      error: [
        AddressBookApiForbidden,
        AddressBookContextUnavailable,
        AddressBookApiError,
      ],
    }).annotate(
      OpenApi.Summary,
      "List the selected customer or company address book"
    )
  );

export class AddressBookApiGroup extends makeAddressBookApiGroup(
  CommerceRequestHeaders
) {}
