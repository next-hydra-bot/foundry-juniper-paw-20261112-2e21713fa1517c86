import { Context, Effect, Layer } from "effect";

import type { CommerceCustomerId } from "../domain/commerce-account";
import type { Store } from "../store";
import { CommerceAccounts } from "./commerce-accounts";

/** Customer identity and company access, independently of account administration. */
export class CommerceBuyerAccounts extends Context.Service<
  CommerceBuyerAccounts,
  Pick<
    CommerceAccounts["Service"],
    "getCustomerIdByAuthUserId" | "getCustomerProfile"
  > & {
    readonly listBusinessUnitMembershipsForCustomerInStore: (
      customerId: CommerceCustomerId,
      store: Store
    ) => ReturnType<
      CommerceAccounts["Service"]["listBusinessUnitMembershipsForCustomerInStore"]
    >;
  }
>()("@repo/commerce-core/CommerceBuyerAccounts") {
  static readonly layerFromAccounts = Layer.effect(
    CommerceBuyerAccounts,
    Effect.gen(function* () {
      const accounts = yield* CommerceAccounts;
      return {
        getCustomerIdByAuthUserId: accounts.getCustomerIdByAuthUserId,
        getCustomerProfile: accounts.getCustomerProfile,
        listBusinessUnitMembershipsForCustomerInStore: (
          customerId: CommerceCustomerId,
          store: Store
        ) =>
          accounts.listBusinessUnitMembershipsForCustomerInStore(
            customerId,
            store.storeKey
          ),
      };
    })
  );
}
