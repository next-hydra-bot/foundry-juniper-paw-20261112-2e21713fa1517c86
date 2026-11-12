import { Context, Effect } from "effect";

import type { CommerceCustomerProfile } from "../domain/commerce-account";
import { CommerceRequestContextNotFound } from "../domain/commerce-request-context";
import type {
  CommercePrincipal,
  AuthenticatedCommercePrincipal,
} from "../domain/commerce-request-context";
import type { Store } from "../store";
import type {
  CommerceAccountUnavailable,
  CommerceCustomerProfileNotFound,
} from "./commerce-accounts";

export type CommerceContextProfileFailure =
  | CommerceRequestContextNotFound
  | CommerceCustomerProfileNotFound
  | CommerceAccountUnavailable;

export class CommerceContext extends Context.Service<
  CommerceContext,
  {
    readonly store: Store;
    readonly principal: CommercePrincipal;
    readonly customerPrincipal: () => Effect.Effect<
      AuthenticatedCommercePrincipal,
      CommerceRequestContextNotFound
    >;
    readonly customerProfile: () => Effect.Effect<
      CommerceCustomerProfile,
      CommerceContextProfileFailure
    >;
  }
>()("@repo/commerce-core/CommerceContext") {
  static readonly customerPrincipal = Effect.fn(
    "CommerceContext.customerPrincipal"
  )(function* () {
    const context = yield* CommerceContext;
    return yield* context.customerPrincipal();
  });

  static readonly customerProfile = Effect.fn(
    "CommerceContext.customerProfile"
  )(function* () {
    const context = yield* CommerceContext;
    return yield* context.customerProfile();
  });
  /** Company-only capabilities must not accept personal customer authority. */
  static readonly companyPrincipal = Effect.fn(
    "CommerceContext.companyPrincipal"
  )(function* () {
    const principal = yield* CommerceContext.customerPrincipal();
    if (principal._tag !== "CustomerCommercePrincipal") {
      return yield* new CommerceRequestContextNotFound({
        message: "Company purchasing requires a verified Business Unit",
        reason: "noBuyingContext",
      });
    }
    return principal;
  });
}
