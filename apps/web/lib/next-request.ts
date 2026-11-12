import "server-only";
import { NextRequestApi } from "@repo/actions/next-request";
import { Effect, Layer } from "effect";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";

import { localeFromHeaders } from "../i18n/request-locale";

export type { NextCookieStore } from "@repo/actions/next-request";
export { NextRequestApi } from "@repo/actions/next-request";

export const nextRequestApiLayer = Layer.succeed(NextRequestApi, {
  connect: Effect.fn("NextRequestApi.connect")(() =>
    Effect.promise(connection)
  ),
  getCookies: Effect.fn("NextRequestApi.getCookies")(() =>
    Effect.promise(cookies)
  ),
  getLocale: Effect.fn("NextRequestApi.getLocale")(() =>
    Effect.promise(async () => localeFromHeaders(await headers()))
  ),
});
