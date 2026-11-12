import { makeSchemaErrorIssues } from "@repo/errors";
import { Effect, Option, Schema } from "effect";

import { OrderQueryFailure } from "../domain/order-history";
import type { OrderMoney } from "../domain/order-history";

export type OrderPageResult<A> =
  | { readonly value: A; readonly error?: never }
  | { readonly error: OrderQueryFailure["reason"]; readonly value?: never };
// Keep diagnostic metadata, not request headers, response bodies or Schema input values.
const Diagnostic = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  operation: Schema.optional(Schema.String),
  code: Schema.optional(Schema.Union([Schema.String, Schema.Finite])),
  message: Schema.optional(Schema.String),
  statusCode: Schema.optional(Schema.Finite),
  cause: Schema.optional(Schema.Unknown),
});
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This logging boundary parses opaque provider exceptions and schema failures before projecting safe metadata.
const privateDiagnostic = (error: unknown) => {
  const decoded = Schema.decodeUnknownOption(Diagnostic)(error);
  const { cause, ...metadata } = Option.getOrElse(decoded, () => ({
    cause: undefined,
    name: "UnknownFailure",
  }));
  return {
    cause,
    metadata: Schema.isSchemaError(error)
      ? {
          ...metadata,
          message: "Order response validation failed",
          issues: makeSchemaErrorIssues(error, "Invalid order response"),
        }
      : metadata,
  };
};
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Effect failure causes are intentionally opaque and decoded by privateDiagnostic before logging.
const privateDiagnostics = (error: unknown) => {
  const diagnostics: ReturnType<typeof privateDiagnostic>["metadata"][] = [];
  const seen = new Set<unknown>();
  let current = error;
  for (
    let depth = 0;
    current !== undefined && depth < 4 && !seen.has(current);
    depth += 1
  ) {
    seen.add(current);
    const entry = privateDiagnostic(current);
    diagnostics.push(entry.metadata);
    current = entry.cause;
  }
  return diagnostics;
};

export const presentOrderRead = <A, E, R>(
  program: Effect.Effect<A, E, R>
): Effect.Effect<OrderPageResult<A>, never, R> =>
  program.pipe(
    Effect.tapError((error) =>
      Schema.is(OrderQueryFailure)(error)
        ? Effect.logWarning("Order history request failed", {
            diagnostics: privateDiagnostics(error),
            operation: error.operation,
            reason: error.reason,
          })
        : Effect.logWarning(
            "Order history request could not be authorized or resolved",
            { diagnostics: privateDiagnostics(error) }
          )
    ),
    Effect.match({
      onFailure: (error) => ({
        error: Schema.is(OrderQueryFailure)(error)
          ? error.reason
          : "unavailable",
      }),
      onSuccess: (value) => ({ value }),
    })
  );

/** Keep decimal strings exact rather than converting historic amounts to a float. */
export const formatOrderMoney = (money: OrderMoney, locale: string) => {
  const [integer = "0", fraction = ""] = money.amount.split(".");
  const defaults = new Intl.NumberFormat(locale, {
    currency: money.currencyCode,
    style: "currency",
  }).resolvedOptions();
  const digits = Math.min(
    100,
    Math.max(defaults.minimumFractionDigits ?? 0, fraction.length)
  );
  const formatter = new Intl.NumberFormat(locale, {
    currency: money.currencyCode,
    currencyDisplay: "code",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: "currency",
  });
  const whole = BigInt(integer);
  const numeric = whole === 0n && integer.startsWith("-") ? -0 : whole;
  return formatter
    .formatToParts(numeric)
    .map((part) =>
      part.type === "fraction" ? fraction.padEnd(digits, "0") : part.value
    )
    .join("");
};
