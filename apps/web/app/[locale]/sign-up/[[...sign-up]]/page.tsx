import { SignUp } from "@repo/auth/components/sign-up";
import type { SupportedLocale } from "@repo/i18n/config";
import { getPathname } from "@repo/i18n/navigation";
import { Suspense } from "react";

export default async function SignUpPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: SupportedLocale }>;
}) {
  const { locale } = await params;
  return (
    <Suspense fallback={null}>
      <SignUp
        fallbackRedirectUrl={getPathname({ href: "/", locale })}
        path={getPathname({ href: "/sign-up", locale })}
        signInUrl={getPathname({ href: "/sign-in", locale })}
      />
    </Suspense>
  );
}
