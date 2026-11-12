import "server-only";
import { CustomerAccountPage as AccountPage } from "@repo/commerce-b2c/customer-account";
import type { CustomerAccountPageProps } from "@repo/commerce-b2c/customer-account";
import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Effect } from "effect";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ShopifyCustomerAccounts } from "./accounts";
import { CustomerAccountHandoff } from "./handoff";

export async function requireCustomerAccountUser(
  auth: CustomerAccountPageProps["auth"]
) {
  await connection();
  const session = await auth.readSession();
  if (!session.user || !session.sessionId) {
    const routes = await auth.routes();
    // SAFETY: The selected Auth Provider supplies its own sign-in route.
    redirect(routes.signInHref as Route);
  }
  return session.user;
}

/** Shopify supplies session handoff; Commerce B2C owns the account workflow and UI. */
export async function prepareCustomerAccount({
  auth,
  returnTo,
  locale,
}: {
  readonly auth: CustomerAccountPageProps["auth"];
  readonly returnTo: string;
  readonly locale: Locale;
}) {
  await requireCustomerAccountUser(auth);
  const destination = await NextCommerce.runPromise(
    ShopifyCustomerAccounts.pipe(
      Effect.flatMap((accounts) => accounts.accountDestination(returnTo))
    )
  );
  if (!destination) {
    return null;
  }
  const t = await getTranslations({ locale, namespace: "web.customerAccount" });
  return (
    <CustomerAccountHandoff
      href={destination}
      pendingLabel={t("connectingAccount")}
      continueLabel={t("continueToAccount")}
    />
  );
}

export async function CustomerAccountProfilePage({
  locale,
  auth,
}: {
  readonly locale: Locale;
  readonly auth: CustomerAccountPageProps["auth"];
}) {
  const accountHref = `/${locale}/account/profile`;
  const handoff = await prepareCustomerAccount({
    auth,
    locale,
    returnTo: accountHref,
  });
  if (handoff) {
    return handoff;
  }
  return <AccountPage locale={locale} auth={auth} />;
}
