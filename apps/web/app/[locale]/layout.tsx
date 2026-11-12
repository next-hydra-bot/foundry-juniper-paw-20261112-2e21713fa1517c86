import "@/app/[locale]/styles.css";
import {
  CmsPageLayout,
  CmsLayoutIntegration,
  getNavigation,
} from "@repo/cms/layout";
import { StoreSelector } from "@repo/commerce-core/store/store-selector";
import { LocaleSelector } from "@repo/design-system/components/layout/locale-selector";
import { MobileMenu } from "@repo/design-system/components/layout/mobile-menu";
import { Navigation } from "@repo/design-system/components/layout/navigation";
import type { NavigationItem } from "@repo/design-system/components/layout/navigation";
import { SiteFooter } from "@repo/design-system/components/layout/site-footer";
import { SiteHeader } from "@repo/design-system/components/layout/site-header";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { getLocale, hasLocale, NextIntlClientProvider } from "@repo/i18n";
import { getPathname } from "@repo/i18n/navigation";
import { routing } from "@repo/i18n/routing";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { AccountMenu } from "@/components/layout/account-menu";
import { CommerceProvider } from "@/components/layout/commerce-provider";
import { DocumentShell } from "@/components/layout/document-shell";
import { HeaderCart } from "@/components/layout/header-cart";

export const instant = false;
export const generateStaticParams = () =>
  routing.locales.map((locale) => ({ locale }));

async function PageShell({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  const navigation = await getNavigation(locale);
  // SAFETY: The localized home path is a route in this locale layout.
  const homeHref = getPathname({ href: "/", locale }) as Route;
  const localize = (href: string) => {
    const [, firstSegment] = href.split(/[/?#]/u);
    return href.startsWith("/") &&
      !href.startsWith("//") &&
      !hasLocale(routing.locales, firstSegment)
      ? getPathname({ href, locale })
      : href;
  };
  const localizeItems = (items: NavigationItem[]) =>
    items.map((item) => ({
      ...item,
      children: item.children?.map((child) => ({
        ...child,
        href: localize(child.href),
      })),
      href: item.href ? localize(item.href) : undefined,
    }));
  const navigationItems = localizeItems(navigation.navigationItems);
  const regionSelector = [<StoreSelector />][0] ?? <LocaleSelector />;

  return (
    <CmsPageLayout
      locale={locale}
      footer={
        <SiteFooter
          brandName={navigation.brandName}
          description={navigation.footerDescription}
          homeHref={homeHref}
          items={localizeItems(navigation.footerItems)}
        />
      }
      header={
        <SiteHeader
          brandName={navigation.brandName}
          homeHref={homeHref}
          MainNavigation={<Navigation navigationItems={navigationItems} />}
          RegionSelectorSlot={
            <Suspense
              fallback={
                <div className="h-8 w-16 animate-pulse rounded bg-accent-foreground/15" />
              }
            >
              {regionSelector}
            </Suspense>
          }
          MobileMenuSlot={
            <MobileMenu navigationItems={navigationItems} {...{}} />
          }
          {...{
            AccountSlot: (
              <Suspense
                fallback={
                  <Skeleton
                    aria-hidden="true"
                    className="size-8 rounded-full"
                  />
                }
              >
                <AccountMenu />
              </Suspense>
            ),

            CartSlot: <HeaderCart />,
          }}
        />
      }
    >
      {}
      {children}
    </CmsPageLayout>
  );
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return (
    <DocumentShell lang={locale}>
      <NextIntlClientProvider>
        <CommerceProvider>
          <PageShell>{children}</PageShell>
          <CmsLayoutIntegration />
        </CommerceProvider>
      </NextIntlClientProvider>
    </DocumentShell>
  );
}
