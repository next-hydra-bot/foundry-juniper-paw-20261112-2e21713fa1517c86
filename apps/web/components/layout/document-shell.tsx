import { AnalyticsProvider } from "@repo/analytics";
import { AuthProvider } from "@repo/auth/provider";


import { DesignSystemProvider } from "@repo/design-system";
import { fonts } from "@repo/design-system/lib/fonts";


import { cn } from "@repo/design-system/lib/utils";
import { Toolbar } from "@repo/feature-flags/components/toolbar";

export function DocumentShell({
  children,
  lang,
}: {
  children: React.ReactNode;
  lang: string;
}) {
  return (
    <html
      className={cn(fonts, "scroll-smooth")}
      lang={lang}
      suppressHydrationWarning
    >
      <body>
        <AuthProvider>
            <AnalyticsProvider>
              <DesignSystemProvider>{children}</DesignSystemProvider>
            </AnalyticsProvider>
          </AuthProvider>
        {null}
        <Toolbar />
      </body>
    </html>
  );
}
