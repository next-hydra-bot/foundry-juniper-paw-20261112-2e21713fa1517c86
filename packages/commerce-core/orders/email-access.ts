import { Effect, Option, Schema, Redacted } from "effect";
import type { Layer } from "effect";
import { NextResponse } from "next/server";

import { FindEmailOrderInput } from "../domain/order-access";
import { orderAccessLinksLayer } from "../lib/orders/access-links";
import { OrderAccessLinks } from "../services/order-access-links";

/** Separate Orders keep separate credentials; locale only changes presentation. */
export const emailOrderAccessCookieName = (orderId: string) =>
  `commerce-order-access.${encodeURIComponent(orderId)
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")}`;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, noarchive",
};

export const emailOrderAccessHandler =
  (links: Layer.Layer<OrderAccessLinks>) =>
  async (
    request: Request,
    context: {
      readonly params: Promise<{
        readonly locale: string;
        readonly id: string;
      }>;
    }
  ): Promise<Response> => {
    const { locale, id } = await context.params;
    const url = new URL(request.url);
    const tokens = url.searchParams.getAll("token");
    const parsed = Schema.decodeUnknownOption(
      Schema.toCodecJson(FindEmailOrderInput)
    )({
      id,
      locale,
      token: tokens.length === 1 ? tokens[0] : undefined,
    });
    if (Option.isNone(parsed)) {
      return new Response(null, { headers, status: 404 });
    }
    const input = parsed.value;
    const verified = await Effect.runPromise(
      Effect.gen(function* () {
        const access = yield* (yield* OrderAccessLinks).verify(input.token);
        return Option.isSome(access) && access.value.orderId === input.id;
      }).pipe(
        Effect.provide(links),
        Effect.match({
          onFailure: () => "unavailable" as const,
          onSuccess: (value) => value,
        })
      )
    );
    if (verified !== true) {
      return new Response(null, {
        headers,
        status: verified === false ? 404 : 503,
      });
    }
    const path = `/${input.locale}/orders/${encodeURIComponent(input.id)}`;
    const response = NextResponse.redirect(new URL(path, url), {
      headers,
      status: 303,
    });
    response.cookies.set(
      emailOrderAccessCookieName(input.id),
      Redacted.value(input.token),
      {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: url.protocol === "https:",
      }
    );
    return response;
  };

export const handleEmailOrderAccess = emailOrderAccessHandler(
  orderAccessLinksLayer
);
