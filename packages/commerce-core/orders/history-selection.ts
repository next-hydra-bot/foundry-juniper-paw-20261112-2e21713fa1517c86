import { DateTime, Option, Schema } from "effect";

import { ListOrdersInput } from "../domain/order-history";
import { OrderId } from "../domain/order-identity";
import type { CommerceLocale } from "../store";
import { storeConfiguration } from "../store";

export type OrderSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;
export type OrderHistoryMode = "personal" | "company";
export const orderHistoryStatuses = [
  "unfulfilled",
  "fulfilled",
  "cancelled",
] as const;

/** Page params carry a URI component; providers receive the original opaque ID. */
export const orderIdFromRoute = (value: string | undefined) =>
  Option.getOrNull(
    Schema.decodeUnknownOption(
      Schema.StringFromUriComponent.pipe(Schema.decodeTo(OrderId))
    )(value)
  );

const Search = Schema.Struct({
  after: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
  number: Schema.optional(Schema.String),
  purchaseOrderNumber: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Literals(["", ...orderHistoryStatuses])),
  store: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
});

const searchValue = (value?: string) => {
  const text = value?.trim();
  return text === "" ? undefined : text;
};

const calendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return undefined;
  }
  const parsed = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString)(
    `${value}T00:00:00.000Z`
  );
  return Option.isSome(parsed) &&
    DateTime.formatIso(parsed.value).slice(0, 10) === value
    ? parsed.value
    : undefined;
};

/** Browser dates include the last calendar day; domain bounds remain explicit UTC instants. */
export const orderHistoryInput = (
  locale: CommerceLocale,
  search: OrderSearchParams,
  mode: OrderHistoryMode
): Option.Option<ListOrdersInput> => {
  const parsed = Schema.decodeUnknownOption(Search)(
    mode === "company"
      ? search
      : { after: search.after, number: search.number, status: search.status }
  );
  if (Option.isNone(parsed)) {
    return Option.none();
  }
  const raw = parsed.value;
  const status = raw.status === "" ? undefined : raw.status;
  const store = raw.store?.trim();
  if (store && !storeConfiguration.some((item) => item.storeKey === store)) {
    return Option.none();
  }
  const from = raw.from?.trim();
  const to = raw.to?.trim();
  const start = from ? calendarDate(from) : undefined;
  const end = to ? calendarDate(to) : undefined;
  if ((from && !start) || (to && !end)) {
    return Option.none();
  }
  return Schema.decodeUnknownOption(ListOrdersInput)({
    after: searchValue(raw.after),
    filters: {
      cancellation:
        status && (status === "cancelled" ? "cancelled" : "notCancelled"),
      createdBefore: end
        ? DateTime.formatIso(DateTime.add(end, { days: 1 }))
        : undefined,
      createdFrom: start ? DateTime.formatIso(start) : undefined,
      fulfillment: status === "cancelled" ? undefined : status,
      number: searchValue(raw.number),
      purchaseOrderNumber: searchValue(raw.purchaseOrderNumber),
    },
    limit: 20,
    locale,
    stores: store
      ? { _tag: "SingleStore", storeKey: store }
      : { _tag: "AllStores" },
  });
};

/** The same selection follows pagination and the journey to an Order and back. */
export const orderHistorySearch = (
  input: Pick<ListOrdersInput, "after" | "filters" | "stores">
) => {
  const query = new URLSearchParams();
  if (input.stores._tag === "SingleStore") {
    query.set("store", input.stores.storeKey);
  }
  if (input.after) {
    query.set("after", input.after);
  }
  const { filters } = input;
  if (filters?.number) {
    query.set("number", filters.number);
  }
  if (filters?.purchaseOrderNumber) {
    query.set("purchaseOrderNumber", filters.purchaseOrderNumber);
  }
  if (filters?.createdFrom) {
    query.set("from", DateTime.formatIso(filters.createdFrom).slice(0, 10));
  }
  if (filters?.createdBefore) {
    query.set(
      "to",
      DateTime.formatIso(
        DateTime.subtractDuration(filters.createdBefore, "1 millis")
      ).slice(0, 10)
    );
  }
  if (filters?.cancellation === "cancelled") {
    query.set("status", "cancelled");
  } else if (
    filters?.fulfillment === "fulfilled" ||
    filters?.fulfillment === "unfulfilled"
  ) {
    query.set("status", filters.fulfillment);
  }
  return query;
};
