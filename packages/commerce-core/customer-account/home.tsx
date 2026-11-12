import type {
  AuthRoutes,
  AuthSession,
  AuthUser,
} from "@repo/auth-contract/session";
import { CustomerAreaContent } from "@repo/design-system/components/layout/customer-area";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export function CustomerAccountHomeView({
  user,
  labels,
}: {
  readonly user: Pick<AuthUser, "firstName" | "lastName" | "email">;
  readonly labels: {
    readonly title: string;
    readonly details: string;
  };
}) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return (
    <CustomerAreaContent title={labels.title}>
      <Card>
        <CardHeader>
          <CardTitle>{labels.details}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          {name ? <p className="font-medium">{name}</p> : null}
          {user.email ? (
            <p className="text-sm text-muted-foreground">{user.email}</p>
          ) : null}
        </CardContent>
      </Card>
    </CustomerAreaContent>
  );
}

/** Overview uses the verified site identity; purchasing features own their additional requirements. */
export async function CustomerAccountHome({
  locale,
  auth,
}: {
  readonly locale: Locale;
  readonly auth: {
    readonly readSession: () => Promise<AuthSession>;
    readonly routes: () => Promise<AuthRoutes>;
  };
}) {
  await connection();
  const session = await auth.readSession();
  if (!session.user) {
    const routes = await auth.routes();
    // SAFETY: The selected authentication provider owns its sign-in destination.
    redirect(routes.signInHref as Route);
  }
  const t = await getTranslations({
    locale,
    namespace: "web.customerArea.overview",
  });
  return (
    <CustomerAccountHomeView
      user={session.user}
      labels={{
        title: t("title"),
        details: t("details"),
      }}
    />
  );
}
