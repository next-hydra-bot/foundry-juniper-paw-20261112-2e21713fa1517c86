import { i18nProxy } from "@repo/i18n/proxy";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { withCustomerAccountRoutes } from "./proxy";

describe("Shopify account routing", () => {
  const proxy = withCustomerAccountRoutes(i18nProxy);

  it.each([
    "login",
    "authorize",
    "refresh",
    "logout/continue",
    "logout/complete",
  ])("preserves the unlocalized %s protocol path and query", (route) => {
    const request = new NextRequest(
      `https://store.example/account/${route}?state=oauth-state&code=oauth-code`
    );
    const response = proxy(request);
    expect([
      response.headers.get("location"),
      response.headers.get("x-middleware-rewrite"),
      request.nextUrl.pathname,
    ]).toEqual([null, null, `/account/${route}`]);
  });

  it("still localizes ordinary account and catalog pages", () => {
    const responses = ["/account", "/products"].map((path) =>
      proxy(new NextRequest(`https://store.example${path}`))
    );
    expect(
      responses.map((response) => response.headers.get("x-middleware-rewrite"))
    ).toEqual([
      "https://store.example/en-US/account",
      "https://store.example/en-US/products",
    ]);
  });
});
