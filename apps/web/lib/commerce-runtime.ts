import "server-only";
import { toError } from "@repo/errors/boundary";
import type { Locale } from "@repo/i18n/types";
import { Effect, Layer } from "effect";

import { Actions } from "./actions";
export { Actions } from "./actions";
import { CommerceApp, AppRuntime } from "./app-runtime";
import type { NextCommerceRequestOptions } from "./commerce-request";
import { nextCommerceRequest } from "./commerce-request";

export const CommerceActions = Actions.provide(({ locale }) =>
  Layer.unwrap(
    nextCommerceRequest(locale).pipe(
      Effect.map((request) => CommerceApp.requestLayer(request))
    )
  )
);
export const NextCommerce = {
  provideContext:
    (locale: Locale, options?: NextCommerceRequestOptions) =>
    <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* nextCommerceRequest(locale, options);
        return yield* program.pipe(
          Effect.provide(CommerceApp.contextLayer(request.context))
        );
      }),
  provideAddressBook: CommerceApp.provideAddressBook,
  provide:
    (locale: Locale, options?: NextCommerceRequestOptions) =>
    <A, E, R>(program: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const request = yield* nextCommerceRequest(locale, options);
        return yield* program.pipe(
          Effect.provide(CommerceApp.requestLayer(request))
        );
      }),
  runPromise: async <A, E>(program: Effect.Effect<A, E, ManagedServices>) =>
    await AppRuntime.runPromise(
      program.pipe(
        Effect.mapError((error) =>
          toError(error, "The commerce request failed.")
        )
      )
    ),
};
type ManagedServices = Effect.Services<
  Parameters<typeof AppRuntime.runPromise>[0]
>;
