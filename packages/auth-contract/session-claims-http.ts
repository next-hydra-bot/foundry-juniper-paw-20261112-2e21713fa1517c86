import { Effect, Layer, Schema } from "effect";
import type { Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { SessionClaimsProvisioningError } from "./session-claims-provisioning";

/** The HTTP seam retains status diagnostics without logging credentials or response bodies. */
export const makeSessionClaimsHttp = (
  baseUrl: string,
  secret: Redacted.Redacted,
  fetchApi: typeof fetch = globalThis.fetch
) => {
  const client = HttpClient.HttpClient.pipe(
    Effect.provide(
      Layer.fresh(FetchHttpClient.layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(FetchHttpClient.Fetch, fetchApi),
            Layer.succeed(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            })
          )
        )
      )
    )
  );
  return Effect.fn("SessionClaims.request")(
    function* (
      method: "GET" | "PUT" | "PATCH",
      path: string,
      body?: Readonly<Record<string, Schema.Json>>,
      allowNotFound?: boolean
    ) {
      const http = yield* client;
      let request = HttpClientRequest.make(method)(`${baseUrl}${path}`).pipe(
        HttpClientRequest.bearerToken(secret)
      );
      if (body !== undefined) {
        request = yield* HttpClientRequest.bodyJson(request, body);
      }
      const response = yield* http.execute(request);
      if (allowNotFound === true && response.status === 404) {
        return undefined;
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new SessionClaimsProvisioningError({
          message: `Session claim ${method} failed (HTTP ${response.status}). Check customer provisioning credentials and API access.`,
        });
      }
      return yield* response.json;
    },
    Effect.timeout("20 seconds"),
    Effect.mapError((error) =>
      Schema.is(SessionClaimsProvisioningError)(error)
        ? error
        : new SessionClaimsProvisioningError({
            message:
              "The session claim API request failed. Read the current template before retrying.",
          })
    )
  );
};
