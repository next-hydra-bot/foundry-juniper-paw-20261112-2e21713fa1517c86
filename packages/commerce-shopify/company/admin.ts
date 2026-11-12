import "server-only";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { ShopifyAdminAccessToken } from "../admin/access-token";
import { shopifyAdminHttpClientLayer } from "../admin/http-client";
import { adminKeys } from "../admin/keys";
import type { ShopifyAdminEnvironment } from "../admin/keys";

export class ShopifyCompanyAdmin extends Context.Service<
  ShopifyCompanyAdmin,
  {
    readonly request: (
      query: string,
      variables?: Readonly<Record<string, Schema.Json>>
    ) => Effect.Effect<Record<string, Schema.Json>, CommerceAccountUnavailable>;
  }
>()("@repo/commerce-shopify/CompanyAdmin") {
  static readonly layerWith = (
    environment: ShopifyAdminEnvironment,
    fetchApi: typeof fetch = globalThis.fetch
  ) =>
    Layer.effect(
      ShopifyCompanyAdmin,
      Effect.gen(function* () {
        const credentials = yield* ShopifyAdminAccessToken;
        const http = yield* HttpClient.HttpClient;
        return ShopifyCompanyAdmin.of({
          request: Effect.fn("ShopifyCompanyAdmin.request")(
            (
              query: string,
              variables: Readonly<Record<string, Schema.Json>> = {}
            ) =>
              Effect.gen(function* () {
                const token = yield* credentials.get;
                const request = yield* HttpClientRequest.bodyJson(
                  HttpClientRequest.post(
                    `https://${environment.SHOPIFY_STORE_DOMAIN}/admin/api/2026-10/graphql.json`
                  ).pipe(
                    HttpClientRequest.setHeader(
                      "x-shopify-access-token",
                      Redacted.value(token)
                    )
                  ),
                  { query, variables }
                );
                const response = yield* http.execute(request);
                if (response.status === 401) {
                  yield* credentials.invalidate(token);
                  return yield* new CommerceAccountUnavailable({
                    message:
                      "Shopify rejected Admin authentication; retry after checking access.",
                  });
                }
                if (response.status < 200 || response.status >= 300) {
                  return yield* new CommerceAccountUnavailable({
                    message:
                      "Shopify company administration is unavailable; reconcile the operation before retrying.",
                  });
                }
                return yield* response.text;
              }).pipe(
                Effect.timeout("30 seconds"),
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.fromJsonString(
                      Schema.Struct({
                        data: Schema.optionalKey(
                          Schema.NullOr(
                            Schema.Record(Schema.String, Schema.Json)
                          )
                        ),
                        errors: Schema.optionalKey(
                          Schema.Array(Schema.Unknown)
                        ),
                      })
                    )
                  )
                ),
                Effect.flatMap((response) =>
                  response.data && (response.errors?.length ?? 0) === 0
                    ? Effect.succeed(response.data)
                    : Effect.fail(
                        new CommerceAccountUnavailable({
                          message: "Shopify rejected company administration",
                        })
                      )
                ),
                Effect.mapError(
                  () =>
                    new CommerceAccountUnavailable({
                      message:
                        "Shopify company administration could not be completed",
                    })
                )
              )
          ),
        });
      })
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          ShopifyAdminAccessToken.layerWith(environment, fetchApi),
          shopifyAdminHttpClientLayer(fetchApi)
        )
      )
    );
  static readonly layer = Layer.suspend(() =>
    ShopifyCompanyAdmin.layerWith(adminKeys())
  );
}

export const decodeCompanyResource = <S extends Schema.Top>(
  schema: S,
  value: Schema.Json | undefined
) =>
  Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError(
      () =>
        new CommerceAccountUnavailable({
          message: "Shopify returned an incomplete company resource",
        })
    )
  );

export const companyMutationResult = (
  data: Record<string, Schema.Json>,
  name: string
) =>
  decodeCompanyResource(
    Schema.Struct({
      userErrors: Schema.Array(Schema.Struct({ message: Schema.String })),
    }),
    data[name]
  ).pipe(
    Effect.flatMap((result) =>
      result.userErrors.length
        ? Effect.fail(
            new CommerceAccountUnavailable({
              message: "Shopify rejected the company change",
            })
          )
        : decodeCompanyResource(
            Schema.Record(Schema.String, Schema.Json),
            data[name]
          )
    )
  );
