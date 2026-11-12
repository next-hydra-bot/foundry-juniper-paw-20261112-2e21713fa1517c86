import { makeDisplayActionResultSchema } from "@repo/actions";
import type {
  AddressBookAccessDenied,
  AddressBookEntryNotFound,
  AddressBookProviderFailure,
  AddressBookWriteOutcomeUnknown,
} from "@repo/commerce-core/domain/address-book";
import {
  AddressBookReference,
  AddressBookOperation,
  AddressBookMutationRejected,
} from "@repo/commerce-core/domain/address-book";
import type { CommerceRequestContextNotFound } from "@repo/commerce-core/domain/commerce-request-context";
import { ProviderFailureReason } from "@repo/commerce-core/domain/provider-failure";
import type {
  CommerceAccountUnavailable,
  CommerceCustomerEmailConflict,
} from "@repo/commerce-core/services/commerce-accounts";
import { definePublicError } from "@repo/errors";
import type { InputInvalid } from "@repo/errors";
import { Effect, Schema } from "effect";

export const CustomerAccountUnauthenticatedFailure = definePublicError({
  category: "unauthenticated",
  code: "customerAccount.unauthenticated",
  fields: {},
  recovery: "reauthenticate",
  status: 401,
  tag: "CustomerAccountUnauthenticated",
});

export const CustomerAccountEmailRequiredFailure = definePublicError({
  category: "conflict",
  code: "customerAccount.emailRequired",
  fields: {},
  recovery: "request_access",
  status: 409,
  tag: "CustomerAccountEmailRequired",
});

const EmailConflict = definePublicError({
  category: "conflict",
  code: "customerAccount.emailConflict",
  fields: {},
  recovery: "fix_input",
  status: 409,
  tag: "CommerceCustomerEmailConflict",
});

const AccountUnavailable = definePublicError({
  category: "unavailable",
  code: "customerAccount.unavailable",
  fields: {},
  recovery: "retry",
  status: 503,
  tag: "CommerceAccountUnavailable",
});

const ContextUnavailable = definePublicError({
  category: "not_found",
  code: "customerAccount.contextUnavailable",
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

const AddressAccessDenied = definePublicError({
  category: "forbidden",
  code: "customerAccount.address.forbidden",
  fields: { operation: AddressBookOperation },
  recovery: "request_access",
  status: 403,
  tag: "AddressBookAccessDenied",
});

const AddressUnavailable = definePublicError({
  category: "unavailable",
  code: "customerAccount.address.unavailable",
  fields: { operation: AddressBookOperation, reason: ProviderFailureReason },
  recovery: "retry",
  status: 503,
  tag: "AddressBookProviderFailure",
});

const AddressOutcomeUnknown = definePublicError({
  category: "unavailable",
  code: "customerAccount.address.outcomeUnknown",
  fields: { reference: AddressBookReference },
  recovery: "refresh",
  status: 503,
  tag: "AddressBookWriteOutcomeUnknown",
});

const AddressNotFound = definePublicError({
  category: "not_found",
  code: "customerAccount.address.notFound",
  fields: { reference: AddressBookReference },
  recovery: "refresh",
  status: 404,
  tag: "AddressBookEntryNotFound",
});

type CustomerAccountIdentityError =
  | typeof CustomerAccountUnauthenticatedFailure.schema.Type
  | typeof CustomerAccountEmailRequiredFailure.schema.Type;

export type CustomerAccountExpectedFailure =
  | CustomerAccountIdentityError
  | CommerceCustomerEmailConflict
  | CommerceAccountUnavailable
  | CommerceRequestContextNotFound
  | AddressBookAccessDenied
  | AddressBookEntryNotFound
  | AddressBookProviderFailure
  | AddressBookWriteOutcomeUnknown
  | AddressBookMutationRejected;

export const CustomerAccountActionError = Schema.Union([
  AddressBookMutationRejected,
  CustomerAccountUnauthenticatedFailure.schema,
  CustomerAccountEmailRequiredFailure.schema,
  EmailConflict.schema,
  AccountUnavailable.schema,
  ContextUnavailable.schema,
  AddressAccessDenied.schema,
  AddressNotFound.schema,
  AddressUnavailable.schema,
  AddressOutcomeUnknown.schema,
]);
export type CustomerAccountActionError = typeof CustomerAccountActionError.Type;

const toPublicError = (
  error: CustomerAccountExpectedFailure
): CustomerAccountActionError => {
  switch (error._tag) {
    case "CustomerAccountUnauthenticated":
    case "CustomerAccountEmailRequired": {
      return error;
    }
    case "AddressBookMutationRejected": {
      return error;
    }
    case "CommerceCustomerEmailConflict": {
      return EmailConflict.make({
        message:
          "The sign-in email is already associated with another Customer.",
      });
    }
    case "CommerceAccountUnavailable": {
      return AccountUnavailable.make({
        message: "The Customer account is temporarily unavailable.",
      });
    }
    case "CommerceRequestContextNotFound": {
      return ContextUnavailable.make({
        message: "The Customer account context is unavailable.",
        reason: error.reason,
      });
    }
    case "AddressBookAccessDenied": {
      return AddressAccessDenied.make({
        message: "Address Book access is denied.",
        operation: error.operation,
      });
    }
    case "AddressBookEntryNotFound": {
      return AddressNotFound.make({
        message: "This saved address is no longer available.",
        reference: error.reference,
      });
    }
    case "AddressBookProviderFailure": {
      return AddressUnavailable.make({
        message: "The Address Book is temporarily unavailable.",
        operation: error.operation,
        reason: error.reason,
      });
    }
    case "AddressBookWriteOutcomeUnknown": {
      return AddressOutcomeUnknown.make({
        message: "Refresh the account to check whether this address changed.",
        reference: error.reference,
      });
    }
    default: {
      return error satisfies never;
    }
  }
};

export const projectCustomerAccountFailure = <A, R>(
  program: Effect.Effect<A, CustomerAccountExpectedFailure, R>
) =>
  program.pipe(
    Effect.tapError((error) =>
      Effect.logError("Customer account operation failed", error)
    ),
    Effect.catchTag("AddressBookProviderFailure", (error) =>
      error.reason === "unavailable" ? Effect.fail(error) : Effect.die(error)
    ),
    Effect.mapError(toPublicError)
  );

export const customerAccountFailureMessageKey = (
  error: CustomerAccountActionError | InputInvalid
) => {
  switch (error._tag) {
    case "InputInvalid": {
      return "invalidInput";
    }
    case "CustomerAccountUnauthenticated": {
      return "unauthenticated";
    }
    case "CustomerAccountEmailRequired": {
      return "emailRequired";
    }
    case "CommerceCustomerEmailConflict": {
      return "emailConflict";
    }
    case "AddressBookWriteOutcomeUnknown": {
      return "addressOutcomeUnknown";
    }
    case "AddressBookMutationRejected": {
      return error.reason === "defaultAddressRemoval"
        ? "defaultAddressRemoval"
        : "addressRejected";
    }
    case "AddressBookEntryNotFound": {
      return "addressNotFound";
    }
    case "CommerceRequestContextNotFound":
    case "AddressBookAccessDenied": {
      return "contextUnavailable";
    }
    case "CommerceAccountUnavailable":
    case "AddressBookProviderFailure": {
      return "unavailable";
    }
    default: {
      return error satisfies never;
    }
  }
};

export const CustomerAccountActionResult = makeDisplayActionResultSchema(
  Schema.Null,
  CustomerAccountActionError
);
export type CustomerAccountActionResult =
  typeof CustomerAccountActionResult.Encoded;
export type CustomerAccountAction = (
  previous: CustomerAccountActionResult | null,
  form: FormData
) => Promise<CustomerAccountActionResult>;
