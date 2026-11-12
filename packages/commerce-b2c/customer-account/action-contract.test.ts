import { ActionClient } from "@repo/actions";
import {
  AddressBookAccessDenied,
  AddressBookProviderFailure,
  AddressBookReference,
  AddressBookWriteOutcomeUnknown,
  addressBookMutationRejected,
} from "@repo/commerce-core/domain/address-book";
import { CommerceRequestContextNotFound } from "@repo/commerce-core/domain/commerce-request-context";
import {
  CommerceAccountUnavailable,
  CommerceCustomerEmailConflict,
} from "@repo/commerce-core/services/commerce-accounts";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CustomerAccountActionError,
  CustomerAccountActionResult,
  customerAccountFailureMessageKey,
  projectCustomerAccountFailure,
} from "./action-contract";
import type { CustomerAccountExpectedFailure } from "./action-contract";

const actions = ActionClient.make(ManagedRuntime.make(Layer.empty));
const actionFor = (failure: CustomerAccountExpectedFailure) =>
  actions
    .procedure("CustomerAccount.boundaryTest")
    .input(Schema.fromFormData(Schema.Struct({})))
    .output(Schema.Null)
    .error(CustomerAccountActionError)
    .handle(() => projectCustomerAccountFailure(Effect.fail(failure)))
    .toFormAction({ getFailureMessage: customerAccountFailureMessageKey });

describe("Customer account Action errors", () => {
  it.each([
    {
      failure: addressBookMutationRejected({
        message: "Check this address.",
        reference: AddressBookReference.make("address-1"),
      }),
      recovery: "fix_input",
      tag: "AddressBookMutationRejected",
    },
    {
      failure: new CommerceCustomerEmailConflict({
        message: "private email diagnostic",
      }),
      recovery: "fix_input",
      tag: "CommerceCustomerEmailConflict",
    },
    {
      failure: new CommerceAccountUnavailable({
        cause: new Error("provider-secret"),
        message: "private provider diagnostic",
      }),
      recovery: "retry",
      tag: "CommerceAccountUnavailable",
    },
    {
      failure: new CommerceRequestContextNotFound({
        message: "private context diagnostic",
        reason: "noCustomerMapping",
      }),
      recovery: "refresh",
      tag: "CommerceRequestContextNotFound",
    },
    {
      failure: new AddressBookAccessDenied({
        message: "private permission diagnostic",
        operation: "save",
      }),
      recovery: "request_access",
      tag: "AddressBookAccessDenied",
    },
    {
      failure: new AddressBookProviderFailure({
        cause: new Error("provider-secret"),
        message: "private provider diagnostic",
        operation: "save",
        reason: "unavailable",
      }),
      recovery: "retry",
      tag: "AddressBookProviderFailure",
    },
  ])(
    "preserves $tag and its recovery after serialization",
    async ({ failure, tag, recovery }) => {
      const result = await actionFor(failure)(null, new FormData());
      const encoded = JSON.stringify(result);
      const decoded = Schema.decodeUnknownSync(CustomerAccountActionResult)(
        JSON.parse(encoded)
      );
      expect(Result.isFailure(decoded)).toBeTruthy();
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          error: {
            _tag: tag,
            recovery,
          },
        },
      });
      expect(encoded).not.toMatch(/private|provider-secret|"cause"/u);
    }
  );

  it("retains the address reference and requires refresh for an unknown write outcome", async () => {
    const result = await actionFor(
      new AddressBookWriteOutcomeUnknown({
        cause: new Error("provider-secret"),
        message: "private write diagnostic",
        reference: AddressBookReference.make("home-address"),
      })
    )(null, new FormData());
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        displayMessage: "addressOutcomeUnknown",
        error: {
          _tag: "AddressBookWriteOutcomeUnknown",
          recovery: "refresh",
          reference: "home-address",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it("rejects invalid provider data as a defect rather than suggesting a retry", async () => {
    const action = actionFor(
      new AddressBookProviderFailure({
        message: "Invalid provider response",
        operation: "save",
        reason: "invalidData",
      })
    );
    await expect(action(null, new FormData())).rejects.toThrow(
      "Invalid provider response"
    );
  });
});
