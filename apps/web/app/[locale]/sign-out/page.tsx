import { SignOut } from "@repo/auth/components/sign-out";
import type { SignOutProps } from "@repo/auth/components/sign-out";
import { LOGOUT_CONTINUATION_PATH as redirectUrl } from "@repo/commerce-provider/customer-account/logout";
import { prepareSignOut as prepareSignOutAction } from "@repo/commerce-provider/customer-account/sign-out-action";
import type { SupportedLocale } from "@repo/i18n/config";
import { getPathname } from "@repo/i18n/navigation";

const preparation: SignOutProps = { redirectUrl, prepareSignOutAction };

export default async function SignOutPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: SupportedLocale }>;
}) {
  const { locale } = await params;
  return (
    <SignOut
      {...preparation}
      redirectUrl={
        preparation.redirectUrl ?? getPathname({ href: "/", locale })
      }
    />
  );
}
