import { AuthUserInput } from "@repo/auth-contract/user-input";
import { readJsonInputs } from "@repo/cli-core/json-migrations";
import { Effect, Path, Schema } from "effect";

import { CustomerInput } from "../domain/customer";
import { CustomerIdentityLinkInput } from "../domain/customer-identity-link";

export interface CustomerProvisioningInputs {
  readonly authUsers: readonly AuthUserInput[];
  readonly customers: readonly CustomerInput[];
  readonly identityLinks: readonly CustomerIdentityLinkInput[];
}

export class CustomerProvisioningInputInvalid extends Schema.TaggedError<CustomerProvisioningInputInvalid>()(
  "CustomerProvisioningInputInvalid",
  {
    message: Schema.String,
  }
) {}

export const validateCustomerProvisioningInputs = (
  inputs: CustomerProvisioningInputs
) =>
  Effect.gen(function* () {
    const users = new Set<string>(inputs.authUsers.map(({ key }) => key));
    const customers = new Set<string>(inputs.customers.map(({ key }) => key));
    if (
      users.size !== inputs.authUsers.length ||
      customers.size !== inputs.customers.length
    ) {
      return yield* new CustomerProvisioningInputInvalid({
        message:
          "Auth User and Customer keys must be unique within their input files.",
      });
    }
    const linkedUsers = new Set<string>();
    const linkedCustomers = new Set<string>();
    for (const link of inputs.identityLinks) {
      if (
        !users.has(link.authUserKey) ||
        !customers.has(link.customerKey) ||
        linkedUsers.has(link.authUserKey) ||
        linkedCustomers.has(link.customerKey)
      ) {
        return yield* new CustomerProvisioningInputInvalid({
          message:
            "Customer Identity Links must reference unique Auth Users and Customers.",
        });
      }
      linkedUsers.add(link.authUserKey);
      linkedCustomers.add(link.customerKey);
    }
    return inputs;
  });

/** Shared by B2C setup and the customer portion of B2B setup. */
export const loadCustomerProvisioningInputs = (directory: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const inputs = yield* Effect.all(
      {
        authUsers: readJsonInputs(
          AuthUserInput,
          path.join(directory, "auth-users.json")
        ),
        customers: readJsonInputs(
          CustomerInput,
          path.join(directory, "customers.json")
        ),
        identityLinks: readJsonInputs(
          CustomerIdentityLinkInput,
          path.join(directory, "customer-identity-links.json")
        ),
      },
      { concurrency: "unbounded" }
    );
    return yield* validateCustomerProvisioningInputs(inputs);
  });
