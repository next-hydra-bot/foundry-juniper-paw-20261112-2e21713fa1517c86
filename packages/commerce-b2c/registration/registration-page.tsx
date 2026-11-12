import { Button } from "@repo/design-system/components/ui/button";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { connection } from "next/server";
import type { ReactNode } from "react";

import type { CustomerAccountAuth } from "../customer-account/auth";
import { submitCustomerRegistration } from "./actions";
import { CustomerRegistrationForm } from "./form";

export type CustomerRegistrationAccess =
  | { readonly kind: "anonymous"; readonly signInHref: string }
  | {
      readonly kind: "authenticated";
      readonly profile: {
        readonly email: string | null;
        readonly firstName: string | null;
        readonly lastName: string | null;
      };
    };

export interface CustomerRegistrationPageProps {
  readonly locale: Locale;
  readonly auth: CustomerAccountAuth;
  readonly footer?: ReactNode;
}

export async function CustomerRegistrationPage({
  locale,
  auth,
  footer,
}: CustomerRegistrationPageProps) {
  await connection();
  const session = await auth.readSession();
  let access: CustomerRegistrationAccess;
  if (session.user === null) {
    const routes = await auth.routes();
    access = { kind: "anonymous", signInHref: routes.signInHref };
  } else {
    access = {
      kind: "authenticated",
      profile: {
        email: session.user.email,
        firstName: session.user.firstName,
        lastName: session.user.lastName,
      },
    };
  }
  const t = await getTranslations({ locale, namespace: "web.customerAccount" });
  let content: ReactNode;
  if (access.kind === "anonymous") {
    content = (
      <div className="grid justify-items-start gap-4">
        <p>{t("signInDescription")}</p>
        <Button asChild>
          <a href={access.signInHref}>{t("signIn")}</a>
        </Button>
      </div>
    );
  } else if (access.profile.email === null) {
    content = <p role="alert">{t("emailRequired")}</p>;
  } else {
    content = (
      <CustomerRegistrationForm
        action={submitCustomerRegistration}
        profile={{
          email: access.profile.email,
          firstName: access.profile.firstName ?? "",
          lastName: access.profile.lastName ?? "",
        }}
      />
    );
  }

  return (
    <main className="min-h-[calc(100vh-10rem)] bg-[radial-gradient(circle_at_top,_rgba(120,113,108,0.12),_transparent_55%),linear-gradient(180deg,_#fafaf9,_#f5f5f4)] px-6 py-16">
      <div className="mx-auto grid max-w-4xl gap-8">
        <h1 className="text-balance font-semibold text-4xl text-stone-950">
          {t("registrationTitle")}
        </h1>
        {content}
        {footer}
      </div>
    </main>
  );
}
