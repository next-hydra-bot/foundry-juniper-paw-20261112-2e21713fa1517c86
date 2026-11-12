import { Effect, Layer } from "effect";
import { FetchHttpClient, Headers } from "effect/http";

/** Shared transport policy for server-to-server Shopify Admin requests. */
export const shopifyAdminHttpClientLayer = (
  fetchApi: typeof fetch = globalThis.fetch
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const redactedNames = yield* Headers.CurrentRedactedNames;
      return Layer.fresh(FetchHttpClient.layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(FetchHttpClient.Fetch, fetchApi),
            Layer.succeed(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            }),
            Layer.succeed(Headers.CurrentRedactedNames, [
              ...redactedNames,
              "x-shopify-access-token",
            ])
          )
        )
      );
    })
  );
