import "server-only";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n";
import { Link } from "@repo/i18n/navigation";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { ReactNode } from "react";

import { CommerceContextObservation } from "../commerce-context/commerce-context-observation";
import { CommerceLocale, resolveStore } from "../store";
import { getPublicCategory, getPublicCategories } from "./catalog-reads";
import type { ProductCategoryDetail } from "./category";
import type { CategorySlug } from "./identity";

export const categoriesPath = "/categories";
export const categoryPath = (slug: CategorySlug): Route =>
  // SAFETY: The Commerce Search recipe installs the detail route; encode the slug as one path segment.
  `/categories/${encodeURIComponent(slug)}` as Route;

export function CategoryPageSkeleton() {
  return (
    <div aria-busy="true" className="container space-y-6 py-10 lg:py-14">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-6 w-80 max-w-full" />
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <Skeleton className="h-36 rounded-xl" key={key} />
        ))}
      </div>
    </div>
  );
}

/** React cache deduplicates metadata and page reads within one request only. */
export const loadCategory = cache(async (locale: Locale, slug: string) => {
  const category = await getPublicCategory(locale, slug);
  if (category === null) {
    notFound();
  }
  return category;
});

export async function generateCategoryMetadata({
  locale,
  slug,
}: {
  readonly locale: Locale;
  readonly slug: string;
}): Promise<Metadata> {
  const category = await loadCategory(locale, slug);
  return { description: category.description, title: category.name };
}

export async function CategoryPageFrame({
  category,
  children,
  locale,
}: {
  readonly category: ProductCategoryDetail;
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: "web.categories" });
  return (
    <div className="container py-10 lg:py-14">
      <div className="mb-10 max-w-3xl">
        <Link
          className="text-muted-foreground text-sm underline underline-offset-4"
          href={categoriesPath}
          locale={locale}
        >
          {t("allCategories")}
        </Link>
        <h1 className="mt-4 font-semibold text-4xl tracking-tight">
          {category.name}
        </h1>
        {category.description ? (
          <p className="mt-3 whitespace-pre-line text-muted-foreground">
            {category.description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export async function CategoryIndexPage({
  locale,
}: {
  readonly locale: Locale;
}) {
  const store = resolveStore({ locale: CommerceLocale.make(locale) });
  const [categories, t] = await Promise.all([
    getPublicCategories(locale),
    getTranslations({ locale, namespace: "web.categories" }),
  ]);
  return (
    <>
      <CommerceContextObservation store={store} />
      <div className="container py-10 lg:py-14">
        <h1 className="font-semibold text-4xl tracking-tight">{t("title")}</h1>
        <p className="mt-3 text-muted-foreground">{t("description")}</p>
        {categories.length === 0 ? (
          <p className="mt-10">{t("empty")}</p>
        ) : (
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  className="block h-full rounded-xl border p-6 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  href={categoryPath(category.slug)}
                  locale={locale}
                >
                  <h2 className="font-semibold text-xl">{category.name}</h2>
                  {category.description ? (
                    <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">
                      {category.description}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
