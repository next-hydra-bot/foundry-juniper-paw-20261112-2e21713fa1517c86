import { AuthUserId } from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceBuyerAccounts } from "@repo/commerce-core/services/commerce-buyer-accounts";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import { Link } from "@repo/i18n/navigation";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { ShopifyCustomerAccounts } from "../customer-account/accounts";

export async function CompanyPage({
  locale,
  registrationLink,
}: {
  readonly locale: Locale;
  readonly registrationLink?: ReactNode;
}) {
  const result = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const accounts = yield* ShopifyCustomerAccounts;
      const identity = yield* accounts.read;
      if (!identity?.accessToken) {
        return {
          destination: yield* accounts.checkoutDestination(
            `/${locale}/company`
          ),
          memberships: undefined,
        };
      }
      const buyers = yield* CommerceBuyerAccounts;
      const customerId = yield* buyers.getCustomerIdByAuthUserId(
        AuthUserId.make(identity.authUserId)
      );
      return {
        destination: undefined,
        memberships:
          yield* buyers.listBusinessUnitMembershipsForCustomerInStore(
            customerId,
            resolveStore({ locale: CommerceLocale.make(locale) })
          ),
      };
    })
  );
  if (result.memberships === undefined) {
    redirect(result.destination ?? `/${locale}/sign-in`);
  }
  return (
    <main className="container mx-auto min-h-96 max-w-2xl space-y-4 px-4 py-12">
      <h1 className="text-2xl font-semibold">Company purchasing</h1>
      {result.memberships.length === 0 ? (
        <>
          <p>
            Your account has no company location available in this store.
            Contact your company administrator to arrange access.
          </p>
          {registrationLink}
        </>
      ) : (
        <>
          <p>
            Use the company selector to choose the location you are purchasing
            for.
          </p>
          <Link href="/" locale={locale}>
            Continue shopping
          </Link>
        </>
      )}
    </main>
  );
}
