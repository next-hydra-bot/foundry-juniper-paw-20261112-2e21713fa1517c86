import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Option, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { EmailOrderAccess, OrderAccessToken } from "../../domain/order-access";
import { OrderId } from "../../domain/order-identity";
import { OrderAccessLinks } from "../../services/order-access-links";
import { CommerceLocale, StoreKey } from "../../store";
import {
  orderAccessLinksLayer,
  orderAccessLinksLayerWith,
} from "./access-links";

const access = new EmailOrderAccess({
  orderId: OrderId.make("opaque/order"),
  recipient: Redacted.make("buyer@example.test", { label: "email" }),
  storeKey: StoreKey.make("original-store"),
});
const configuration = {
  origin: "https://shop.example.test",
  secret: Redacted.make(Buffer.alloc(32, 1).toString("base64url")),
};
const layer = orderAccessLinksLayerWith(configuration);
const tokenFrom = (url: Redacted.Redacted) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(OrderAccessToken))(
    new URL(Redacted.value(url)).searchParams.get("token")
  );

describe("email Order access links", () => {
  it.effect(
    "loads the private issuer key and storefront origin through Effect config",
    () =>
      Effect.gen(function* () {
        const links = yield* OrderAccessLinks;
        const url = yield* links.issue(access, CommerceLocale.make("en-US"));
        expect(Option.getOrThrow(yield* links.verify(tokenFrom(url)))).toEqual(
          access
        );
      }).pipe(
        Effect.provide(orderAccessLinksLayer),
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              COMMERCE_ORDER_ACCESS_SECRET: Redacted.value(
                configuration.secret
              ),
              NEXT_PUBLIC_WEB_URL: configuration.origin,
            })
          )
        )
      )
  );
  it.effect(
    "issues an opaque link for exactly one recipient, Order and original Store",
    () =>
      Effect.gen(function* () {
        const links = yield* OrderAccessLinks;
        const url = yield* links.issue(access, CommerceLocale.make("en-US"));
        expect(new URL(Redacted.value(url)).pathname).toBe(
          "/en-US/orders/opaque%2Forder/access"
        );
        expect(Redacted.value(url)).not.toContain("buyer@example.test");
        expect(Option.getOrThrow(yield* links.verify(tokenFrom(url)))).toEqual(
          access
        );
        yield* TestClock.adjust("365 days");
        expect(Option.getOrThrow(yield* links.verify(tokenFrom(url)))).toEqual(
          access
        );
      }).pipe(Effect.provide(layer))
  );

  it.effect(
    "rejects tampered or malformed credentials and tokens issued with another key",
    () =>
      Effect.gen(function* () {
        const links = yield* OrderAccessLinks;
        const token = tokenFrom(
          yield* links.issue(access, CommerceLocale.make("en-US"))
        );
        const raw = Redacted.value(token);
        const tampered = `${raw.slice(0, 20)}${raw[20] === "A" ? "B" : "A"}${raw.slice(21)}`;
        expect(
          Option.isNone(yield* links.verify(Redacted.make(tampered)))
        ).toBeTruthy();
        expect(
          Option.isNone(yield* links.verify(Redacted.make("invalid")))
        ).toBeTruthy();
        const rotated = yield* Effect.gen(function* () {
          return yield* (yield* OrderAccessLinks).verify(token);
        }).pipe(
          Effect.provide(
            orderAccessLinksLayerWith({
              ...configuration,
              secret: Redacted.make(Buffer.alloc(32, 2).toString("base64url")),
            })
          )
        );
        expect(Option.isNone(rotated)).toBeTruthy();
      }).pipe(Effect.provide(layer))
  );
});
