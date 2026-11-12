import { describe, expect, it } from "@effect/vitest";
import { NextRequestApi } from "@repo/actions/next-request";
import type { NextCookieStore } from "@repo/actions/next-request";
import { NextServer } from "@repo/actions/next-server";
import {
  PURCHASING_CONTEXT_COOKIE_NAME,
  PURCHASING_CONTEXT_COOKIE_OPTIONS,
} from "@repo/commerce-core/commerce-context/purchasing-context-cookie";
import { Effect, Layer } from "effect";

import { selectB2CPurchasingProgram } from "./programs";

describe("personal purchasing selection", () => {
  it.effect("persists personal purchasing before refreshing the route", () => {
    const calls: string[] = [];
    const cookies: NextCookieStore = {
      delete: () => {
        throw new Error("Company selection must be retained");
      },
      get: () => undefined,
      set: (name, value, options) => {
        expect(name).toBe(PURCHASING_CONTEXT_COOKIE_NAME);
        expect(value).toBe("personal");
        expect(options).toEqual(PURCHASING_CONTEXT_COOKIE_OPTIONS);
        calls.push("cookie");
      },
    };
    const layer = Layer.mergeAll(
      Layer.succeed(NextRequestApi, {
        connect: () => Effect.void,
        getLocale: () => Effect.succeed("en-US" as const),
        getCookies: () => Effect.succeed(cookies),
      }),
      Layer.succeed(NextServer, {
        refresh: () =>
          Effect.sync(() => {
            calls.push("refresh");
          }),
        revalidatePath: () => Effect.void,
      })
    );
    return Effect.gen(function* () {
      yield* selectB2CPurchasingProgram();
      expect(calls).toEqual(["cookie", "refresh"]);
    }).pipe(Effect.provide(layer));
  });
});
