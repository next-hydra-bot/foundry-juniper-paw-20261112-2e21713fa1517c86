import { Context, Effect, Layer } from "effect";

import type { CommerceAccount } from "../domain/commerce-account";
import type { CompanyPurchasingPolicy } from "../domain/company-purchasing-policy";
import type { StoreKey } from "../store";
import { CommerceAccountUnavailable } from "./commerce-accounts";

export class CompanyPurchasingPolicies extends Context.Service<
  CompanyPurchasingPolicies,
  {
    readonly list: (
      storeKey: StoreKey
    ) => Effect.Effect<
      readonly CompanyPurchasingPolicy[],
      CommerceAccountUnavailable
    >;
    readonly assign: (input: {
      readonly account: CommerceAccount;
      readonly policy: CompanyPurchasingPolicy;
    }) => Effect.Effect<void, CommerceAccountUnavailable>;
  }
>()("@repo/commerce-core/CompanyPurchasingPolicies") {
  /** Explicit manual-assignment composition: approval offers no automatic policy. */
  static readonly layerManual = Layer.succeed(CompanyPurchasingPolicies, {
    assign: () =>
      Effect.fail(
        new CommerceAccountUnavailable({
          message:
            "No company purchasing policies are configured for automatic assignment.",
        })
      ),
    list: () => Effect.succeed([]),
  });
}
