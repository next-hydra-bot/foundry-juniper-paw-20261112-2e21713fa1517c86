import type { NextCookieStore } from "@repo/actions/next-request";

import { CART_COOKIE_NAME } from "../cart/session";
import { CUSTOMER_COOKIE_NAME } from "./session-cookie";

export const LOGOUT_CONTINUATION_PATH = "/account/logout/continue";
export const LOGOUT_COMPLETION_PATH = "/account/logout/complete";

/** Only provider-owned cookies are discarded; site authentication ends through its own SDK. */
export const clearShopifyCookies = (
  cookies: NextCookieStore,
  request: Request
) => {
  const names = new Set([
    CART_COOKIE_NAME,
    ...Array.from(
      { length: 4 },
      (_, index) => `${CUSTOMER_COOKIE_NAME}.${index}`
    ),
    ...(request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.split("=", 1)[0]?.trim() ?? "")
      .filter((name) => /^shopify-cart(?:\.[a-f0-9]{20})?$/u.test(name)),
  ]);
  for (const name of names) {
    cookies.delete(name);
  }
};

/** Match the public request host, independently of Shopify's registered OAuth origin. */
export const logoutRequestOrigin = (request: Request): string | undefined => {
  const url = new URL(request.url);
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host") ??
    url.host;
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    url.protocol.slice(0, -1);
  const target = URL.parse(`${protocol}://${host}`);
  return target &&
    (target.protocol === "https:" || target.protocol === "http:") &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash
    ? target.origin
    : undefined;
};

export const isSameOriginLogout = (request: Request) => {
  const source = URL.parse(
    request.headers.get("origin") ?? request.headers.get("referer") ?? ""
  );
  return (
    request.method === "POST" &&
    source !== null &&
    source.origin === logoutRequestOrigin(request)
  );
};
