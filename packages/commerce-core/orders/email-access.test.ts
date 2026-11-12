import { Effect, Redacted } from "effect";
import { NextResponse } from "next/server";
import { describe, expect, it } from "vitest";

import { EmailOrderAccess } from "../domain/order-access";
import { OrderId } from "../domain/order-identity";
import { orderAccessLinksLayerWith } from "../lib/orders/access-links";
import { OrderAccessLinks } from "../services/order-access-links";
import { CommerceLocale, StoreKey } from "../store";
import { emailOrderAccessHandler } from "./email-access";

const layer = orderAccessLinksLayerWith({
  origin: "https://shop.example.test",
  secret: Redacted.make(Buffer.alloc(32, 1).toString("base64url")),
});
const context = (id = "order-1", locale = "en-US") => ({
  params: Promise.resolve({ id, locale }),
});
const issue = async (id = "order-1") =>
  await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* OrderAccessLinks).issue(
        new EmailOrderAccess({
          orderId: OrderId.make(id),
          recipient: Redacted.make("buyer@example.test", { label: "email" }),
          storeKey: StoreKey.make("original"),
        }),
        CommerceLocale.make("en-US")
      );
    }).pipe(Effect.provide(layer))
  );
describe("email Order access entry", () => {
  it("exchanges a valid link for a private per-Order cookie available across locales and a clean URL", async () => {
    const response = await emailOrderAccessHandler(layer)(
      new Request(Redacted.value(await issue())),
      context()
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://shop.example.test/en-US/orders/order-1"
    );
    expect(response.headers.get("set-cookie")).toContain(
      "commerce-order-access.order-1="
    );
    expect(response.headers.get("set-cookie")?.split("; ")).toContain("Path=/");
    expect({
      httpOnly: response.headers.get("set-cookie")?.includes("HttpOnly"),
      noStore: response.headers.get("cache-control")?.includes("no-store"),
      referrerPolicy: response.headers.get("referrer-policy"),
      secure: response.headers.get("set-cookie")?.includes("Secure"),
    }).toEqual({
      httpOnly: true,
      noStore: true,
      referrerPolicy: "no-referrer",
      secure: true,
    });
  });

  it("keeps independent Order credentials with stable names across locales", async () => {
    const credentials = await Promise.all(
      [
        { id: "order-1", locale: "en-US" },
        { id: "order-1", locale: "fr-FR" },
        { id: "opaque/order(a)?", locale: "fr-FR" },
      ].map(async ({ id, locale }) => {
        const response = await emailOrderAccessHandler(layer)(
          new Request(Redacted.value(await issue(id))),
          context(id, locale)
        );
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(
          `https://shop.example.test/${locale}/orders/${encodeURIComponent(id)}`
        );
        const cookies = new NextResponse(null, {
          headers: response.headers,
        }).cookies.getAll();
        expect(cookies).toHaveLength(1);
        for (const cookie of cookies) {
          expect(cookie.path).toBe("/");
          expect(cookie.httpOnly).toBeTruthy();
          expect(cookie.name).toMatch(/^[\w.%~-]+$/u);
        }
        return cookies[0]?.name;
      })
    );
    expect(credentials[0]).toBe(credentials[1]);
    expect(credentials[0]).not.toBe(credentials[2]);
  });

  it("rejects another Order, missing, repeated and invalid tokens without setting a credential", async () => {
    const url = new URL(Redacted.value(await issue()));
    const repeated = new URL(url);
    repeated.searchParams.append("token", "another");
    const handler = emailOrderAccessHandler(layer);
    for (const response of [
      await handler(new Request(url), context("other")),
      await handler(
        new Request("https://shop.example.test/en-US/orders/order-1/access"),
        context()
      ),
      await handler(new Request(repeated), context()),
      await handler(
        new Request(
          "https://shop.example.test/en-US/orders/order-1/access?token=invalid"
        ),
        context()
      ),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers.has("set-cookie")).toBeFalsy();
    }
  });
});
