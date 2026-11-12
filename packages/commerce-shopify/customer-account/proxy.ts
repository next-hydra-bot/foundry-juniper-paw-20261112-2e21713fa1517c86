import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const accountRoutes = new Set([
  "/account/login",
  "/account/authorize",
  "/account/refresh",
  "/account/logout/continue",
  "/account/logout/complete",
]);

/** Hydrogen's OAuth paths are fixed and must reach route handlers without a locale rewrite. */
export const withCustomerAccountRoutes =
  (localize: (request: NextRequest) => NextResponse) =>
  (request: NextRequest): NextResponse =>
    accountRoutes.has(request.nextUrl.pathname)
      ? NextResponse.next()
      : localize(request);
