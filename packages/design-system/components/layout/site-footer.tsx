import type { Route } from "next";
import Link from "next/link";

import type { NavigationItem } from "./navigation";

const linkClassName =
  "text-muted-foreground transition-colors hover:text-primary";

const linkHref = (href: string): Route =>
  // SAFETY: CMS navigation includes the application's catch-all paths and external links.
  href as Route;

type SiteFooterProps = {
  brandName?: string;
  description?: string;
  homeHref: string;
  items: NavigationItem[];
};

export function SiteFooter({
  brandName,
  description,
  homeHref,
  items,
}: SiteFooterProps) {
  const hasIdentity = Boolean(brandName) || Boolean(description);
  if (!hasIdentity && items.length === 0) {
    return null;
  }

  return (
    <footer className="border-t bg-muted/30">
      <div className="container flex flex-wrap gap-x-12 gap-y-8 py-12">
        {hasIdentity && (
          <div className="max-w-sm space-y-3">
            {brandName && (
              <Link className="font-bold text-xl" href={linkHref(homeHref)}>
                {brandName}
              </Link>
            )}
            {description && (
              <p className="text-muted-foreground text-sm">{description}</p>
            )}
          </div>
        )}
        {items.length > 0 && (
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-8 gap-y-4 text-sm">
              {items.map(({ title, href, children }) => (
                <li key={`${title}:${href ?? ""}`} className="space-y-2">
                  {href ? (
                    <Link className={linkClassName} href={linkHref(href)}>
                      {title}
                    </Link>
                  ) : (
                    <span className="font-semibold">{title}</span>
                  )}
                  {children && children.length > 0 && (
                    <ul className="space-y-2">
                      {children.map((child) => (
                        <li key={`${child.title}:${child.href}`}>
                          <Link
                            className={linkClassName}
                            href={linkHref(child.href)}
                          >
                            {child.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </footer>
  );
}
