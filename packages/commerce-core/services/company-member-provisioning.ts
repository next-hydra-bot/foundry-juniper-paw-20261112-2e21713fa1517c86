import { Context, Effect, Layer } from "effect";

import type { CommerceBusinessUnitId } from "../domain/commerce-account";
import { CommerceAccounts } from "./commerce-accounts";
import type { AddAssociateInput, RedactedString } from "./commerce-accounts";

/** The writes needed to add a verified person to an existing company. */
export class CompanyMemberProvisioning extends Context.Service<
  CompanyMemberProvisioning,
  {
    readonly canAddMember: (input: {
      readonly businessUnitId: CommerceBusinessUnitId;
      readonly email: RedactedString;
    }) => ReturnType<CommerceAccounts["Service"]["hasCustomerWithEmail"]>;
    readonly addMember: (
      input: AddAssociateInput
    ) => ReturnType<CommerceAccounts["Service"]["addAssociate"]>;
  }
>()("@repo/commerce-core/CompanyMemberProvisioning") {
  static readonly layerFromAccounts = Layer.effect(
    CompanyMemberProvisioning,
    Effect.gen(function* () {
      const accounts = yield* CommerceAccounts;
      return CompanyMemberProvisioning.of({
        canAddMember: ({ email }) =>
          accounts
            .hasCustomerWithEmail(email)
            .pipe(Effect.map((exists) => !exists)),
        addMember: accounts.addAssociate,
      });
    })
  );
}
