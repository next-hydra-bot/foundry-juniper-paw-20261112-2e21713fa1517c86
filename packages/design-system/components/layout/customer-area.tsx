import { Badge } from "@repo/design-system/components/ui/badge";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { cn } from "@repo/design-system/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export interface CustomerAreaNavigationItem {
  readonly href?: string;
  readonly label: string;
  readonly statusLabel?: string;
}

export interface CustomerAreaProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly description: string;
  readonly navigation: ReactNode;
  readonly title: string;
}

const navigationLinkClassName =
  "block rounded-md px-3 py-2 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground";

function CustomerAreaLink({
  item,
  current,
}: {
  readonly item: CustomerAreaNavigationItem;
  readonly current: boolean;
}) {
  if (item.href === undefined) {
    return (
      <span
        aria-disabled="true"
        className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-muted-foreground text-sm opacity-70"
      >
        {item.label}
        {item.statusLabel === undefined ? null : (
          <Badge variant="outline">{item.statusLabel}</Badge>
        )}
      </span>
    );
  }
  // SAFETY: Customer-area routes are server-authored application paths, never untrusted input.
  return (
    <Link
      aria-current={current ? "page" : undefined}
      href={item.href as Route}
      prefetch={false}
      className={navigationLinkClassName}
    >
      {item.label}
    </Link>
  );
}

/** Pure navigation props; the host supplies the currently selected destination. */
export function CustomerAreaNavigation({
  items,
  label,
  currentHref,
}: {
  readonly items: readonly CustomerAreaNavigationItem[];
  readonly label: string;
  readonly currentHref?: string;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex gap-2 overflow-x-auto pb-2 md:grid md:overflow-visible md:pb-0">
        {items.map((item) => (
          <li className="shrink-0" key={item.href ?? item.label}>
            <CustomerAreaLink
              item={item}
              current={item.href !== undefined && item.href === currentHref}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Persistent account layout and its first-entry fallback share the same geometry. */
function CustomerAreaFrame({
  header,
  navigation,
  children,
  className,
  busy,
}: {
  readonly header: ReactNode;
  readonly navigation: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly busy?: boolean;
}) {
  return (
    <main
      aria-busy={busy}
      className={cn(
        "mx-auto min-h-[calc(100svh-7rem)] w-full max-w-6xl px-4 py-8 sm:py-12",
        className
      )}
    >
      <header className="mb-8 grid min-h-24 gap-2">{header}</header>
      <div className="grid gap-8 md:grid-cols-[14rem_minmax(0,1fr)]">
        {navigation}
        <div className="min-h-96 min-w-0">{children}</div>
      </div>
    </main>
  );
}

export const CustomerArea = ({
  children,
  className,
  description,
  navigation,
  title,
}: CustomerAreaProps) => (
  <CustomerAreaFrame
    className={className}
    header={
      <>
        <h1 className="font-semibold text-3xl tracking-tight">{title}</h1>
        <p className="max-w-2xl text-muted-foreground">{description}</p>
      </>
    }
    navigation={navigation}
  >
    {children}
  </CustomerAreaFrame>
);

export function CustomerAreaContent({
  children,
  title,
  description,
  accountLabel,
}: {
  readonly children: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly accountLabel?: string;
}) {
  return (
    <section className="min-w-0" aria-label={title}>
      <header className="mb-6 grid gap-2">
        {accountLabel ? (
          <p className="font-medium text-primary text-sm">{accountLabel}</p>
        ) : null}
        <h2 className="font-semibold text-2xl tracking-tight">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Route loaders replace only content inside the account layout. */
export function CustomerAreaContentSkeleton({
  children,
  context = false,
  description = true,
  loadingLabel = "Loading account content",
}: {
  readonly children: ReactNode;
  readonly context?: boolean;
  readonly description?: boolean;
  readonly loadingLabel?: string;
}) {
  return (
    <div
      role="status"
      aria-label={loadingLabel}
      aria-busy="true"
      className="min-h-96 min-w-0"
    >
      <span className="sr-only">{loadingLabel}</span>
      <div aria-hidden="true">
        <div className="mb-6 grid gap-2">
          {context ? <Skeleton className="h-5 w-28" /> : null}
          <Skeleton className="h-8 w-48 max-w-full" />
          {description ? <Skeleton className="h-6 w-80 max-w-full" /> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** Full-shell loading is reserved for the account layout's first entry. */
export function CustomerAreaSkeleton({
  children,
  loadingLabel = "Loading account",
  className,
}: {
  readonly children?: ReactNode;
  readonly loadingLabel?: string;
  readonly className?: string;
}) {
  return (
    <CustomerAreaFrame
      busy
      className={className}
      header={
        <div aria-hidden="true" className="grid gap-2">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="h-6 w-[28rem] max-w-full" />
        </div>
      }
      navigation={
        <div
          aria-hidden="true"
          className="flex gap-2 overflow-hidden pb-2 md:grid md:content-start md:pb-0"
        >
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-9 w-36 shrink-0 md:w-full" />
          ))}
        </div>
      }
    >
      <div role="status" aria-label={loadingLabel} className="min-h-96">
        <span className="sr-only">{loadingLabel}</span>
        <div aria-hidden="true">
          {children ?? (
            <div className="grid gap-4">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
        </div>
      </div>
    </CustomerAreaFrame>
  );
}
