"use client";

import { useSignOut } from "@repo/auth/components/sign-out";
import type { SignOutProps } from "@repo/auth/components/sign-out";
import { DropdownMenuItem } from "@repo/design-system/components/ui/dropdown-menu";
import { useLocale, useTranslations } from "@repo/i18n";
import { getPathname } from "@repo/i18n/navigation";
import { LogOut } from "lucide-react";

export function ClerkSignOutMenuItem(props: SignOutProps) {
  const t = useTranslations("web.header");
  const locale = useLocale();
  const { busy, disabled, failed, signOut } = useSignOut({
    ...props,
    redirectUrl: props.redirectUrl ?? getPathname({ href: "/", locale }),
  });

  return (
    <>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={(event) => {
          event.preventDefault();
          void signOut();
        }}
      >
        <LogOut className="size-4" />
        {busy ? t("signingOut") : t("signOut")}
      </DropdownMenuItem>
      {failed ? (
        <p className="px-2 py-1.5 text-destructive text-xs" role="alert">
          {t("signOutFailed")}
        </p>
      ) : null}
    </>
  );
}
