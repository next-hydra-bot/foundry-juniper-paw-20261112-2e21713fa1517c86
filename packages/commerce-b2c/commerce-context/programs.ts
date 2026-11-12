import { NextRequestApi } from "@repo/actions/next-request";
import { NextServer } from "@repo/actions/next-server";
import {
  PURCHASING_CONTEXT_COOKIE_NAME,
  PURCHASING_CONTEXT_COOKIE_OPTIONS,
} from "@repo/commerce-core/commerce-context/purchasing-context-cookie";
import { Effect } from "effect";

export const selectB2CPurchasingProgram = Effect.fn(
  "PurchasingContext.selectB2C"
)(function* () {
  const request = yield* NextRequestApi;
  const cookieStore = yield* request.getCookies();
  const next = yield* NextServer;
  yield* Effect.sync(() => {
    cookieStore.set(
      PURCHASING_CONTEXT_COOKIE_NAME,
      "personal",
      PURCHASING_CONTEXT_COOKIE_OPTIONS
    );
  });
  yield* next.refresh();
  return null;
});
