import { Context, Effect, Layer, Option } from "effect";

import type { AuthUserId } from "../domain/commerce-request-context";
import { CommerceAccounts } from "./commerce-accounts";
import type {
  CommerceAccountUnavailable,
  RedactedString,
} from "./commerce-accounts";
/** Whether commerce already has an account that prevents a new company application. A login-created customer alone need not prevent it. */
export class CompanyRegistrationEligibility extends Context.Service<
  CompanyRegistrationEligibility,
  {
    readonly hasExistingAccount: (input: {
      readonly email: RedactedString;
      readonly authUserId?: AuthUserId | undefined;
    }) => Effect.Effect<boolean, CommerceAccountUnavailable>;
  }
>()("@repo/commerce-core/CompanyRegistrationEligibility") {
  static readonly layerFromAccounts = Layer.effect(
    CompanyRegistrationEligibility,
    Effect.gen(function* () {
      const accounts = yield* CommerceAccounts;
      return {
        hasExistingAccount: ({ email, authUserId }) =>
          Effect.gen(function* () {
            if (yield* accounts.hasCustomerWithEmail(email)) {
              return true;
            }
            if (authUserId === undefined) {
              return false;
            }
            const linked = yield* accounts
              .getCustomerIdByAuthUserId(authUserId)
              .pipe(
                Effect.map(Option.some),
                Effect.catchTag("CommerceCustomerIdNotFound", () =>
                  Effect.succeed(Option.none())
                )
              );
            return Option.isSome(linked);
          }),
      };
    })
  );
}
