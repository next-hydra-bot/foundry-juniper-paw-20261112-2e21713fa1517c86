import { CustomerAreaContent } from "@repo/design-system/components/layout/customer-area";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/design-system/components/ui/alert";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@repo/design-system/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/design-system/components/ui/collapsible";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import { Separator } from "@repo/design-system/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system/components/ui/table";
import { cn } from "@repo/design-system/lib/utils";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { DateTime, Option, Schema } from "effect";
import type { Route } from "next";
import Form from "next/form";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { FindOrderDetailInput } from "../domain/order-history";
import type {
  OrderAddress,
  OrderDetail,
  OrderPage,
  OrderMoney,
  OrderStatus,
  ListOrdersInput,
} from "../domain/order-history";
import { CommerceLocale, storeConfiguration } from "../store";
import { OrderFilterSelect } from "./filter-select";
import {
  orderHistoryInput,
  orderHistorySearch,
  orderHistoryStatuses,
} from "./history-selection";
import type { OrderHistoryMode, OrderSearchParams } from "./history-selection";
import { OrderRowsSkeleton } from "./loading";
import { formatOrderMoney } from "./presentation";
import type { OrderPageResult } from "./presentation";

export type { OrderSearchParams } from "./history-selection";
export { orderIdFromRoute } from "./history-selection";

const href = (
  locale: Locale,
  input?: Pick<ListOrdersInput, "stores" | "filters" | "after">
) => {
  const query = input ? orderHistorySearch(input) : new URLSearchParams();
  // SAFETY: This path is authored here; selected values are encoded as URL parameters.
  return `/${locale}/account/orders${query.size ? `?${query}` : ""}` as Route;
};
const detailHref = (
  locale: Locale,
  id: FindOrderDetailInput["id"],
  history: Pick<ListOrdersInput, "stores" | "filters" | "after">
) => {
  const query = orderHistorySearch(history);
  // SAFETY: Provider IDs are encoded into one segment; history selection is encoded separately.
  return `/${locale}/account/orders/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}` as Route;
};
const historyMessages = async (locale: Locale) =>
  await getTranslations({ locale, namespace: "web.orderHistory" });
type OrderText = (
  key: Parameters<Awaited<ReturnType<typeof historyMessages>>>[0],
  values?: Readonly<Record<string, string | number>>
) => string;
const OrderReadError = ({
  locale,
  reason,
  t,
  emailAccess = false,
  retryHref,
}: {
  readonly locale: Locale;
  readonly reason: string;
  readonly t: OrderText;
  readonly emailAccess?: boolean;
  readonly retryHref?: Route;
}) => {
  const recoverSelection =
    reason === "invalidCursor" || reason === "invalidFilter";
  let message = t("unavailable");
  switch (reason) {
    case "accessDenied": {
      message = t("accessDenied");
      break;
    }
    case "configuration": {
      message = t("configuration");
      break;
    }
    case "invalidCursor": {
      message = t("invalidCursor");
      break;
    }
    case "invalidFilter": {
      message = t("invalidFilter");
      break;
    }
    default: {
      break;
    }
  }
  let action: ReactNode = null;
  if (!emailAccess && reason !== "accessDenied") {
    action = recoverSelection ? (
      <Button asChild size="sm" variant="outline">
        <Link href={href(locale)}>
          {t(reason === "invalidCursor" ? "firstPage" : "clearFilters")}
        </Link>
      </Button>
    ) : (
      <Button asChild size="sm" variant="outline">
        <a href={retryHref ?? href(locale)}>{t("retry")}</a>
      </Button>
    );
  }
  return (
    <Alert className="py-5">
      <AlertTitle>{t("errorTitle")}</AlertTitle>
      <AlertDescription className="gap-4">
        <p>{message}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
};
const ReadFailure = ({
  locale,
  reason,
  t,
  emailAccess = false,
  retryHref,
}: Parameters<typeof OrderReadError>[0]) => {
  const error = (
    <OrderReadError
      locale={locale}
      reason={reason}
      t={t}
      emailAccess={emailAccess}
      retryHref={retryHref}
    />
  );
  return emailAccess ? (
    <section className="mx-auto min-h-96 max-w-4xl space-y-4 px-4 py-8">
      <h1 className="font-semibold text-2xl">{t("title")}</h1>
      {error}
    </section>
  ) : (
    <CustomerAreaContent title={t("title")} description={t("description")}>
      {error}
    </CustomerAreaContent>
  );
};
function OrderListingFrame({
  t,
  children,
}: {
  readonly t: OrderText;
  readonly children: ReactNode;
}) {
  return (
    <CustomerAreaContent description={t("description")} title={t("title")}>
      {children}
    </CustomerAreaContent>
  );
}

function OrderHistoryFilters({
  locale,
  input,
  mode,
  t,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly t: OrderText;
}) {
  const form = orderHistorySearch(input);
  const stores = [...new Set(storeConfiguration.map((item) => item.storeKey))];
  const activeCount = ["purchaseOrderNumber", "from", "to"].filter((name) =>
    form.has(name)
  ).length;
  let storeSelection: ReactNode = null;
  if (mode === "company" && stores.length > 1) {
    storeSelection = (
      <div className="grid w-full gap-2 sm:w-40">
        <Label htmlFor="order-store">{t("store")}</Label>
        <OrderFilterSelect
          id="order-store"
          name="store"
          defaultValue={form.get("store") ?? ""}
          allLabel={t("allStores")}
          options={stores.map((key) => ({ label: key, value: key }))}
        />
      </div>
    );
  } else if (mode === "company" && input.stores._tag === "SingleStore") {
    storeSelection = (
      <input type="hidden" name="store" value={input.stores.storeKey} />
    );
  }
  return (
    <Form action={href(locale)} className="mb-5" key={form.toString()}>
      <Collapsible defaultOpen={activeCount > 0}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-48 flex-1 gap-2">
            <Label htmlFor="order-number">{t("orderNumberFilter")}</Label>
            <Input
              defaultValue={form.get("number") ?? ""}
              id="order-number"
              name="number"
              type="search"
              placeholder={t("searchPlaceholder")}
            />
          </div>
          <div className="grid w-full gap-2 sm:w-44">
            <Label htmlFor="order-status">{t("statusLabel")}</Label>
            <OrderFilterSelect
              id="order-status"
              name="status"
              defaultValue={form.get("status") ?? ""}
              allLabel={t("anyStatus")}
              options={orderHistoryStatuses.map((value) => ({
                label: t(`status.${value}`),
                value,
              }))}
            />
          </div>
          {storeSelection}
          <Button type="submit" variant="secondary">
            {t("search")}
          </Button>
          {mode === "company" ? (
            <CollapsibleTrigger asChild>
              <Button className="group" type="button" variant="outline">
                {t("filters")}
                {activeCount ? (
                  <Badge variant="secondary">{activeCount}</Badge>
                ) : null}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="size-4 transition-transform group-data-[state=open]:rotate-180"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </Button>
            </CollapsibleTrigger>
          ) : null}
          {mode === "personal" && (form.has("number") || form.has("status")) ? (
            <Button asChild variant="ghost">
              <Link href={href(locale)}>{t("clearFilters")}</Link>
            </Button>
          ) : null}
        </div>
        {mode === "company" ? (
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <div className="mt-4 rounded-lg border bg-muted/20 p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="order-purchaseOrderNumber">
                    {t("purchaseOrderFilter")}
                  </Label>
                  <Input
                    defaultValue={form.get("purchaseOrderNumber") ?? ""}
                    id="order-purchaseOrderNumber"
                    name="purchaseOrderNumber"
                  />
                </div>
                {(["from", "to"] as const).map((name) => (
                  <div className="grid gap-2" key={name}>
                    <Label htmlFor={`order-${name}`}>
                      {t(name === "from" ? "dateFrom" : "dateTo")}
                    </Label>
                    <Input
                      defaultValue={form.get(name) ?? ""}
                      id={`order-${name}`}
                      name={name}
                      type="date"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2 border-t pt-4">
                <Button asChild variant="ghost">
                  <Link href={href(locale)}>{t("clearFilters")}</Link>
                </Button>
                <Button type="submit">{t("apply")}</Button>
              </div>
            </div>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </Form>
  );
}

function OrderStatusBadges({
  status,
  t,
}: {
  readonly status: OrderStatus;
  readonly t: OrderText;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {status.cancellation === "cancelled" ? (
        <Badge variant="outline">{t("status.cancelled")}</Badge>
      ) : null}
      {status.payment === "unknown" ? null : (
        <Badge
          variant={status.payment === "paid" ? "secondary" : "outline"}
          className={
            status.payment === "paid"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : undefined
          }
        >
          {t(`status.${status.payment}`)}
        </Badge>
      )}
      {status.fulfillment !== "unknown" &&
      status.fulfillment !== "notRequired" ? (
        <Badge
          variant={status.fulfillment === "fulfilled" ? "secondary" : "outline"}
        >
          {t(`status.${status.fulfillment}`)}
        </Badge>
      ) : null}
      {status.payment === "unknown" &&
      (status.fulfillment === "unknown" ||
        status.fulfillment === "notRequired") &&
      status.cancellation !== "cancelled" ? (
        <span className="text-muted-foreground text-sm">
          {t("statusUnavailable")}
        </span>
      ) : null}
    </div>
  );
}

function OrderHistoryResults({
  locale,
  input,
  mode,
  result,
  t,
  emptyAction,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly result: OrderPageResult<OrderPage>;
  readonly t: OrderText;
  readonly emptyAction?: ReactNode;
}) {
  if (result.error !== undefined) {
    return (
      <OrderReadError
        locale={locale}
        reason={result.error}
        t={t}
        retryHref={href(locale, input)}
      />
    );
  }
  const filtered =
    input.stores._tag === "SingleStore" ||
    Object.values(input.filters ?? {}).some((value) => value !== undefined);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  let emptyTitle = t("empty");
  let emptyDescription = t("emptyDescription");
  if (result.value.historyLimitDays !== undefined) {
    emptyTitle = t("emptyRecent");
    emptyDescription = t("emptyRecentDescription");
  }
  if (filtered) {
    emptyTitle = t("noMatches");
    emptyDescription = t("noMatchesDescription");
  }
  if (result.value.nextCursor) {
    emptyTitle = t("noMatches");
    emptyDescription = t("emptyPage");
  }
  return (
    <>
      <OrderHistoryFilters locale={locale} input={input} mode={mode} t={t} />
      {result.value.historyLimitDays === undefined ? null : (
        <p className="mb-4 text-muted-foreground text-sm">
          {t("historyLimit", { days: result.value.historyLimitDays })}
        </p>
      )}
      {result.value.items.length === 0 ? (
        <div
          className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center"
          role="status"
        >
          <h3 className="font-semibold text-lg">{emptyTitle}</h3>
          <p className="mt-2 max-w-sm text-muted-foreground text-sm">
            {emptyDescription}
          </p>
          {result.value.nextCursor ? null : (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link href={filtered ? href(locale) : `/${locale}/products`}>
                  {t(filtered ? "clearFilters" : "continueShopping")}
                </Link>
              </Button>
              {emptyAction}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="px-4">{t("order")}</TableHead>
                <TableHead className="hidden px-4 md:table-cell">
                  {t("date")}
                </TableHead>
                <TableHead className="px-4">{t("statusLabel")}</TableHead>
                <TableHead className="px-4 text-right">{t("total")}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t("viewOrder")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.value.items.map((order) => {
                const destination = detailHref(locale, order.id, input);
                const placed = date.format(DateTime.toDateUtc(order.createdAt));
                return (
                  <TableRow key={order.id}>
                    <TableCell className="px-4 py-5">
                      <Link
                        className="font-semibold underline-offset-4 hover:underline"
                        href={destination}
                      >
                        {order.number ?? t("viewOrder")}
                      </Link>
                      {order.purchaseOrderNumber ? (
                        <p className="mt-1 text-muted-foreground text-xs">
                          {t("purchaseOrder")}: {order.purchaseOrderNumber}
                        </p>
                      ) : null}
                      <time
                        className="mt-1 block text-muted-foreground text-xs md:hidden"
                        dateTime={DateTime.formatIso(order.createdAt)}
                      >
                        {placed}
                      </time>
                      {order.storeKey ? (
                        <p className="mt-1 text-muted-foreground text-xs md:hidden">
                          {order.storeKey}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden px-4 py-5 md:table-cell">
                      <time dateTime={DateTime.formatIso(order.createdAt)}>
                        {placed}
                      </time>
                      {order.storeKey ? (
                        <p className="mt-1 text-muted-foreground text-xs">
                          {order.storeKey}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal px-4 py-5">
                      <OrderStatusBadges status={order.status} t={t} />
                    </TableCell>
                    <TableCell className="px-4 py-5 text-right font-medium tabular-nums">
                      {formatOrderMoney(order.total.money, locale)}
                    </TableCell>
                    <TableCell className="pr-3">
                      <Button asChild size="icon" variant="ghost">
                        <Link
                          href={destination}
                          aria-label={`${t("viewOrder")} ${order.number ?? ""}`}
                        >
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="size-4"
                          >
                            <path d="m9 18 6-6-6-6" />
                          </svg>
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {input.after || result.value.nextCursor ? (
        <nav
          aria-label={t("pagination")}
          className="mt-5 flex items-center justify-between gap-3"
        >
          {input.after ? (
            <Button asChild variant="ghost">
              <Link href={href(locale, { ...input, after: undefined })}>
                {t("firstPage")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {result.value.nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={href(locale, {
                  ...input,
                  after: result.value.nextCursor,
                })}
              >
                {t(result.value.items.length ? "nextPage" : "continueSearch")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

/** Presentation receives an explicit read result and has no request or provider dependencies. */
export function OrderListingView({
  locale,
  input,
  mode,
  result,
  t,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly result: OrderPageResult<OrderPage>;
  readonly t: OrderText;
}) {
  return (
    <OrderListingFrame t={t}>
      <OrderHistoryResults
        locale={locale}
        input={input}
        mode={mode}
        result={result}
        t={t}
      />
    </OrderListingFrame>
  );
}
const Address = ({ value }: { readonly value: OrderAddress }) => (
  <address className="text-sm leading-6 not-italic">
    {value.recipient ? <p className="font-medium">{value.recipient}</p> : null}
    {value.company ? <p>{value.company}</p> : null}
    {value.addressLine1 ? <p>{value.addressLine1}</p> : null}
    {value.addressLine2 ? <p>{value.addressLine2}</p> : null}
    {[value.city, value.region, value.postalCode].some(Boolean) ? (
      <p>
        {[value.city, value.region, value.postalCode].filter(Boolean).join(" ")}
      </p>
    ) : null}
    {value.country ? <p>{value.country}</p> : null}
  </address>
);
const isZeroMoney = (money: OrderMoney) => /^-?0(?:\.0+)?$/u.test(money.amount);
export function OrderDetailView({
  locale,
  input,
  result,
  t,
  emailAccess = false,
  history,
}: {
  readonly locale: Locale;
  readonly input: FindOrderDetailInput;
  readonly history?: ListOrdersInput;
  readonly result: OrderPageResult<Option.Option<OrderDetail>>;
  readonly t: OrderText;
  readonly emailAccess?: boolean;
}) {
  const back = history ?? { ...input, limit: 20 };
  if (result.error !== undefined) {
    return (
      <ReadFailure
        locale={locale}
        reason={result.error}
        t={t}
        emailAccess={emailAccess}
        retryHref={detailHref(locale, input.id, back)}
      />
    );
  }
  if (Option.isNone(result.value)) {
    notFound();
  }
  const order = result.value.value;
  const title = `${t("order")} ${order.number ?? order.id}`;
  const Heading = emailAccess ? "h1" : "h2";
  const adjustments = (
    ["discounts", "refunded", "outstanding"] as const
  ).flatMap((key) => {
    const money = order.amounts[key];
    return money && !isZeroMoney(money) ? [{ key, money }] : [];
  });
  return (
    <section
      aria-label={title}
      className={
        emailAccess ? "mx-auto min-h-96 max-w-4xl px-4 py-8" : "min-w-0"
      }
    >
      {emailAccess ? null : (
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 mb-4 text-muted-foreground"
        >
          <Link href={href(locale, back)}>
            <span aria-hidden="true">←</span>
            {t("back")}
          </Link>
        </Button>
      )}
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <CardHeader className="gap-5 px-5 py-6 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="grid gap-3">
              <OrderStatusBadges status={order.status} t={t} />
              <div className="grid gap-1.5">
                <Heading className="font-semibold text-2xl tracking-tight">
                  {title}
                </Heading>
                <time
                  className="text-muted-foreground text-sm"
                  dateTime={DateTime.formatIso(order.createdAt)}
                >
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "long",
                    timeZone: "UTC",
                  }).format(DateTime.toDateUtc(order.createdAt))}
                </time>
              </div>
            </div>
            {order.storeKey || order.purchaseOrderNumber ? (
              <dl className="grid gap-2 text-sm">
                {order.purchaseOrderNumber ? (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                    <dt className="text-muted-foreground">
                      {t("purchaseOrder")}
                    </dt>
                    <dd className="break-words text-right font-medium">
                      {order.purchaseOrderNumber}
                    </dd>
                  </div>
                ) : null}
                {order.storeKey ? (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4">
                    <dt className="text-muted-foreground">{t("store")}</dt>
                    <dd className="break-words text-right">{order.storeKey}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
          {order.status.delivery !== "unknown" &&
          order.status.delivery !== "notRequired" ? (
            <p className="text-muted-foreground text-sm">
              {t("delivery")}: {t(`status.${order.status.delivery}`)}
            </p>
          ) : null}
        </CardHeader>
        <Separator />
        <CardContent className="px-5 sm:px-6">
          <h3 className="pt-5 font-medium text-sm">{t("items")}</h3>
          <ul className="divide-y">
            {order.lineItems.map((line) => (
              <li
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-2 py-5 sm:grid-cols-[4rem_minmax(0,1fr)_auto]"
                key={line.id}
              >
                <div className="relative row-span-2 aspect-square self-start overflow-hidden rounded-lg border bg-muted/40 sm:row-span-1">
                  {line.image ? (
                    <Image
                      src={line.image.url}
                      alt={line.image.altText ?? line.name}
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="grid size-full place-items-center font-medium text-muted-foreground/50 text-xl"
                    >
                      {line.name.charAt(0)}
                    </span>
                  )}
                </div>
                <div className="min-w-0 self-center">
                  <p className="break-words font-medium text-sm">{line.name}</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground text-sm">
                    {(line.variantOptions?.length ?? 0) > 0 ? (
                      <dl className="flex flex-wrap gap-x-3 gap-y-1">
                        {line.variantOptions?.map((option) => (
                          <div className="flex gap-1" key={option.name}>
                            <dt className="capitalize">{option.name}:</dt>
                            <dd>{option.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {(line.variantOptions?.length ?? 0) === 0 &&
                    line.variantLabel ? (
                      <span>{line.variantLabel}</span>
                    ) : null}
                    {(line.variantOptions?.length ?? 0) > 0 ||
                    line.variantLabel ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    <span
                      aria-label={`${t("quantity")}: ${line.orderedQuantity}`}
                    >
                      {t("quantityShort")} {line.orderedQuantity}
                    </span>
                    {line.currentQuantity !== undefined &&
                    line.currentQuantity !== line.orderedQuantity ? (
                      <span>
                        {t("currentQuantity")}: {line.currentQuantity}
                      </span>
                    ) : null}
                  </div>
                  {line.sku ? (
                    <p className="mt-1 break-all text-muted-foreground text-xs">
                      {t("sku")}: {line.sku}
                    </p>
                  ) : null}
                </div>
                <div className="col-start-2 self-center text-sm tabular-nums sm:col-start-3 sm:text-right">
                  {line.total ? (
                    <p className="font-medium">
                      {formatOrderMoney(line.total.money, locale)}
                    </p>
                  ) : null}
                  {!line.total && line.unitPrice ? (
                    <p>
                      {formatOrderMoney(line.unitPrice, locale)} {t("each")}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <Separator />
        <CardContent className="px-5 py-5 sm:px-6">
          <dl className="ml-auto grid w-full gap-3 text-sm sm:max-w-xs">
            {(["subtotal", "shipping", "tax"] as const).map((key) => {
              const amount = order.amounts[key];
              if (!amount) {
                return null;
              }
              const money = "money" in amount ? amount.money : amount;
              return (
                <div
                  className="flex items-baseline justify-between gap-6"
                  key={key}
                >
                  <dt className="text-muted-foreground">
                    {t(
                      key === "tax" &&
                        order.amounts.subtotal?.taxIncluded === "yes"
                        ? "taxIncluded"
                        : key
                    )}
                  </dt>
                  <dd className="shrink-0 tabular-nums">
                    {formatOrderMoney(money, locale)}
                  </dd>
                </div>
              );
            })}
            <div className="mt-1 flex items-baseline justify-between gap-6 border-t pt-4 font-semibold text-base">
              <dt>{t("total")}</dt>
              <dd className="shrink-0 tabular-nums">
                {formatOrderMoney(order.total.money, locale)}
              </dd>
            </div>
          </dl>
          {adjustments.length > 0 ? (
            <section
              className="mt-5 ml-auto w-full border-t pt-4 sm:max-w-xs"
              aria-label={t("adjustments")}
            >
              <h3 className="mb-3 font-medium text-sm">{t("adjustments")}</h3>
              <dl className="grid gap-3 text-sm">
                {adjustments.map(({ key, money }) => (
                  <div
                    className="flex items-baseline justify-between gap-6"
                    key={key}
                  >
                    <dt className="text-muted-foreground">
                      {t(key === "discounts" ? "discountsApplied" : key)}
                    </dt>
                    <dd className="shrink-0 tabular-nums">
                      {formatOrderMoney(money, locale)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </CardContent>
        {order.shippingAddress ||
        order.billingAddress ||
        order.fulfillments.length > 0 ? (
          <>
            <Separator />
            <CardContent
              className={cn(
                "grid gap-6 bg-muted/20 px-5 py-5 sm:grid-cols-2 sm:px-6",
                order.fulfillments.length > 0 && "lg:grid-cols-3"
              )}
            >
              {order.shippingAddress ? (
                <section className="min-w-0">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("shippingAddress")}
                  </h3>
                  <Address value={order.shippingAddress} />
                </section>
              ) : null}
              {order.billingAddress ? (
                <section className="min-w-0">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("billingAddress")}
                  </h3>
                  <Address value={order.billingAddress} />
                </section>
              ) : null}
              {order.fulfillments.length > 0 ? (
                <section className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <h3 className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    {t("tracking")}
                  </h3>
                  <ul className="grid gap-4 text-sm">
                    {order.fulfillments.map((shipment) => (
                      <li className="grid gap-2" key={shipment.id}>
                        {shipment.tracking.length > 0 ? (
                          <ul className="grid gap-2">
                            {shipment.tracking.map((tracking) => (
                              <li
                                className="grid gap-0.5"
                                key={`${tracking.carrier}:${tracking.number}:${tracking.url}`}
                              >
                                {tracking.carrier ? (
                                  <p className="font-medium">
                                    {tracking.carrier}
                                  </p>
                                ) : null}
                                {tracking.url ? (
                                  <a
                                    className="w-fit max-w-full break-all text-muted-foreground underline underline-offset-4 hover:text-foreground"
                                    href={tracking.url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                  >
                                    {tracking.number ?? t("track")}{" "}
                                    <span aria-hidden="true">↗</span>
                                  </a>
                                ) : (
                                  <p className="break-all text-muted-foreground">
                                    {tracking.number}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="flex flex-wrap gap-x-2 text-muted-foreground text-xs">
                          {shipment.status === "unknown" ? null : (
                            <span>{t(`status.${shipment.status}`)}</span>
                          )}
                          {shipment.deliveryStatus !== "unknown" &&
                          shipment.deliveryStatus !== "notRequired" ? (
                            <span>
                              {t(`status.${shipment.deliveryStatus}`)}
                            </span>
                          ) : null}
                        </div>
                        {shipment.lineItems.length > 0 ? (
                          <ul className="grid gap-1 text-muted-foreground text-xs">
                            {shipment.lineItems.map((item) => (
                              <li key={item.lineItemId}>
                                {order.lineItems.find(
                                  (line) => line.id === item.lineItemId
                                )?.name ?? t("items")}{" "}
                                × {item.quantity}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </CardContent>
          </>
        ) : null}
      </Card>
    </section>
  );
}

interface OrderListingPageProps {
  readonly locale: Locale;
  readonly mode: OrderHistoryMode;
  readonly searchParams: OrderSearchParams;
  readonly emptyAction?: ReactNode;
  readonly load: (
    input: ListOrdersInput
  ) => Promise<OrderPageResult<OrderPage>>;
}
async function LoadedOrderHistory({
  locale,
  input,
  mode,
  load,
  t,
  emptyAction,
}: {
  readonly locale: Locale;
  readonly input: ListOrdersInput;
  readonly mode: OrderHistoryMode;
  readonly load: OrderListingPageProps["load"];
  readonly t: OrderText;
  readonly emptyAction?: ReactNode;
}) {
  const result = await load(input);
  return (
    <OrderHistoryResults
      emptyAction={emptyAction}
      locale={locale}
      input={input}
      mode={mode}
      result={result}
      t={t}
    />
  );
}
export const OrderListingPage = async ({
  locale,
  mode,
  searchParams,
  load,
  emptyAction,
}: OrderListingPageProps) => {
  await connection();
  const parsed = orderHistoryInput(
    CommerceLocale.make(locale),
    searchParams,
    mode
  );
  const t = await historyMessages(locale);
  if (Option.isNone(parsed)) {
    return <ReadFailure locale={locale} reason="invalidFilter" t={t} />;
  }
  const input = parsed.value;
  return (
    <OrderListingFrame t={t}>
      <Suspense
        key={orderHistorySearch(input).toString()}
        fallback={<OrderRowsSkeleton />}
      >
        <LoadedOrderHistory
          emptyAction={emptyAction}
          locale={locale}
          input={input}
          mode={mode}
          load={load}
          t={t}
        />
      </Suspense>
    </OrderListingFrame>
  );
};

export const OrderDetailPage = async ({
  locale,
  mode,
  orderId,
  searchParams,
  load,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly mode: OrderHistoryMode;
  readonly searchParams: OrderSearchParams;
  readonly load: (
    input: FindOrderDetailInput
  ) => Promise<OrderPageResult<Option.Option<OrderDetail>>>;
}) => {
  await connection();
  const history = orderHistoryInput(
    CommerceLocale.make(locale),
    searchParams,
    mode
  );
  if (Option.isNone(history)) {
    notFound();
  }
  const input = Schema.decodeUnknownSync(FindOrderDetailInput)({
    id: orderId,
    locale,
    stores: history.value.stores,
  });
  const [result, t] = await Promise.all([load(input), historyMessages(locale)]);
  return (
    <OrderDetailView
      locale={locale}
      input={input}
      result={result}
      t={t}
      history={history.value}
    />
  );
};
