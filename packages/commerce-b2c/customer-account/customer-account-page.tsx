import { NextCommerce } from "@repo/commerce-b2c/bindings";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import {
  saveCustomerProfileAction,
  saveCustomerAddressAction,
  changeCustomerAddressAction,
} from "./actions";
import type { CustomerAccountAuth } from "./auth";
import { CustomerAccountView } from "./customer-account-view";

export interface CustomerAccountPageProps {
  readonly locale: Locale;
  readonly auth: CustomerAccountAuth;
  readonly fallback?: ReactNode;
}

export async function CustomerAccountPage({
  locale,
  auth,
  fallback,
}: CustomerAccountPageProps) {
  await connection();
  const session = await auth.readSession();
  if (session.user === null) {
    const routes = await auth.routes();
    // SAFETY: The selected auth provider supplies this destination; generated Next route types cannot enumerate provider-owned routes.
    redirect(routes.signInHref as Route);
  }
  const account = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const context = yield* CommerceContext;
      if (context.principal._tag !== "B2CPurchasingPrincipal") {
        return { kind: "other" as const };
      }
      const [profile, addresses] = yield* Effect.all(
        [context.customerProfile(), AddressBook.list()],
        { concurrency: "unbounded" }
      );
      return { addresses, kind: "personal" as const, profile };
    }).pipe(
      NextCommerce.provide(locale),
      Effect.catchTag("CommerceRequestContextNotFound", () =>
        Effect.succeed(null)
      )
    )
  );
  if (account === null) {
    redirect(`/${locale}/register/personal`);
  }
  if (account.kind === "other") {
    return await (fallback ?? notFound());
  }
  return (
    <CustomerAccountView
      locale={locale}
      profile={account.profile}
      addresses={account.addresses}
      addressReference={crypto.randomUUID()}
      saveProfile={saveCustomerProfileAction}
      saveAddress={saveCustomerAddressAction}
      changeAddress={changeCustomerAddressAction}
    />
  );
}
