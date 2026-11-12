import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, Schema } from "effect";

import { OrderMoney, OrderQueryFailure } from "../domain/order-history";
import { formatOrderMoney, presentOrderRead } from "./presentation";

describe("order money presentation", () => {
  it.each([
    ["9007199254740993.25", "USD", "USD 9,007,199,254,740,993.25"],
    ["12.345", "BHD", "BHD 12.345"],
    ["1234", "JPY", "JPY 1,234"],
    ["-0.25", "USD", "-USD 0.25"],
  ])(
    "formats %s %s without losing decimal precision",
    (amount, currencyCode, expected) => {
      expect(
        formatOrderMoney(
          Schema.decodeUnknownSync(OrderMoney)({ amount, currencyCode }),
          "en-US"
        )
      ).toBe(expected);
    }
  );
});

it.effect(
  "logs provider diagnostics privately without exposing credentials or causes in the page result",
  () => {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, undefined>((options) => {
      messages.push(options.message);
      return undefined;
    });
    const cause = Object.assign(new Error("Native order query failed"), {
      statusCode: 503,
      request: { headers: { authorization: "secret-token" } },
      response: { body: "private-provider-payload" },
    });
    return Effect.gen(function* () {
      const result = yield* presentOrderRead(
        Effect.fail(
          new OrderQueryFailure({
            cause,
            message: "Orders unavailable",
            operation: "list",
            reason: "unavailable",
          })
        )
      );
      expect(result).toEqual({ error: "unavailable" });
      const log = JSON.stringify(messages);
      expect(log).toContain("Native order query failed");
      expect(log).toContain("503");
      expect(log).not.toContain("secret-token");
      expect(log).not.toContain("private-provider-payload");
    }).pipe(Effect.provide(Logger.layer([logger])));
  }
);

it.effect(
  "records schema issue paths without logging the rejected order data",
  () => {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, undefined>((options) => {
      messages.push(options.message);
      return undefined;
    });
    const response = Schema.Struct({ sku: Schema.NonEmptyString });
    return Effect.gen(function* () {
      const result = yield* Schema.decodeUnknownEffect(response)({
        sku: { privateAddress: "sensitive-input" },
      }).pipe(
        Effect.mapError(
          (cause) =>
            new OrderQueryFailure({
              cause,
              message: "Invalid order data",
              operation: "findById",
              reason: "invalidData",
            })
        ),
        presentOrderRead
      );
      expect(result).toEqual({ error: "invalidData" });
      const log = JSON.stringify(messages);
      expect(log).toContain("sku");
      expect(log).not.toContain("sensitive-input");
    }).pipe(Effect.provide(Logger.layer([logger])));
  }
);
