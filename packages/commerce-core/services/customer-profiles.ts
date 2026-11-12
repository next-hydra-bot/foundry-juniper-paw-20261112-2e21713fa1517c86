import { Context } from "effect";
import type { Effect } from "effect";

import type { CommerceCustomerProfile } from "../domain/commerce-account";
import type { AuthUserId } from "../domain/commerce-request-context";
import type {
  CommerceAccountUnavailable,
  CommerceCustomerEmailConflict,
  RedactedString,
} from "./commerce-accounts";

/** Identity comes from the authenticated session, never from submitted form fields. */
export interface CustomerProfileIdentity {
  readonly authUserId: AuthUserId;
  readonly email: RedactedString;
}

export interface CustomerProfileNames {
  readonly firstName: RedactedString;
  readonly lastName: RedactedString;
}

export class CustomerProfiles extends Context.Service<
  CustomerProfiles,
  {
    /** Creates or updates the authenticated Customer without creating a company. */
    readonly save: (
      identity: CustomerProfileIdentity,
      names: CustomerProfileNames
    ) => Effect.Effect<
      CommerceCustomerProfile,
      CommerceAccountUnavailable | CommerceCustomerEmailConflict
    >;
  }
>()("@repo/commerce-core/CustomerProfiles") {}
