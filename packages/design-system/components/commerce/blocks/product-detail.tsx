import { useTranslations } from "@repo/i18n";
import type { ReactNode } from "react";

export interface ProductDetailProps {
  readonly title: string;
  readonly categoryName?: string;
  readonly children: ReactNode;
  readonly dialogs?: ReactNode;
}

export function ProductDetail({
  title,
  categoryName,
  children,
  dialogs,
}: ProductDetailProps) {
  const t = useTranslations("web.navigation");

  return (
    <div className="container py-12">
      <div className="mb-8 flex items-center gap-2 text-muted-foreground text-sm">
        <span>{t("home")}</span>
        <span>/</span>
        <span>{t("products")}</span>
        <span>/</span>
        <span>{categoryName ?? t("categoryFallback")}</span>
        <span>/</span>
        <span className="text-foreground">{title}</span>
      </div>
      {children}
      {dialogs}
    </div>
  );
}

export function ProductDetailHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description?: string;
}) {
  return (
    <div>
      <h1 className="font-bold text-3xl text-foreground tracking-tight">
        {title}
      </h1>
      <p className="mt-3 text-muted-foreground">{description}</p>
    </div>
  );
}

/** Heading stays in the public shell; media and purchasing can stream independently. */
export function ProductDetailLayout({
  heading,
  children,
}: {
  readonly heading: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="my-6 grid max-w-screen-lg grid-cols-1 gap-x-12 gap-y-6 rounded-lg md:grid-cols-2">
      <div className="order-2 md:order-none md:col-start-2 md:row-start-1">
        {heading}
      </div>
      {children}
    </div>
  );
}

export function ProductDetailMedia({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="relative order-1 h-fit w-full overflow-hidden rounded-2xl bg-muted p-5 md:order-none md:col-start-1 md:row-span-2 md:row-start-1">
      {children}
    </div>
  );
}

export function ProductDetailPurchase({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="order-3 md:order-none md:col-start-2 md:row-start-2">
      {children}
    </div>
  );
}
