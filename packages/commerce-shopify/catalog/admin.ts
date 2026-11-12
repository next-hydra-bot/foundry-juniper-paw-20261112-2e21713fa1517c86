import { Data, Effect, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import {
  DestinationChangeDescriptor,
  DestinationError,
  Tracking,
} from "migrate-sdk";

import { shopifyAdminHttpClientLayer } from "../admin/http-client";
import type { CatalogSettings } from "./destination";

const fail = (message: string) => new DestinationError({ message });
export class ShopifyCompanyCreateRejectedError extends Error {
  override readonly name = "ShopifyCompanyCreateRejectedError";
}
export class ShopifyRequestRejectedError extends Data.TaggedError(
  "ShopifyRequestRejectedError"
) {}
export class ShopifyDeliveryProfileRejectedError extends Data.TaggedError(
  "ShopifyDeliveryProfileRejectedError"
) {}
export const makeCatalogAdmin = (
  settingsSource: Effect.Effect<
    Pick<CatalogSettings, "domain" | "token">,
    DestinationError
  >,
  fetchApi: typeof fetch = globalThis.fetch
) => {
  const client = HttpClient.HttpClient.pipe(
    Effect.provide(shopifyAdminHttpClientLayer(fetchApi))
  );
  const request = Effect.fn("ShopifyCatalog.request")(function* (
    operation: string,
    query: string,
    variables: Readonly<Record<string, Schema.Json>> = {}
  ) {
    const settings = yield* settingsSource.pipe(
      Effect.mapError(
        (error) =>
          new DestinationError({
            cause: new ShopifyRequestRejectedError(),
            message: error.message,
          })
      )
    );
    const body = yield* Effect.gen(function* () {
      const http = HttpClient.filterStatusOk(yield* client);
      const httpRequest = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(
          `https://${settings.domain}/admin/api/2026-10/graphql.json`
        ).pipe(
          HttpClientRequest.setHeader("x-shopify-access-token", settings.token)
        ),
        { query, variables }
      );
      const response = yield* http.execute(httpRequest);
      return yield* response.text;
    }).pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError((error) => {
        const status = HttpClientError.isHttpClientError(error)
          ? error.response?.status
          : undefined;
        let detail =
          "Admin request failed. Check connectivity, app access and API limits.";
        if (status === 401) {
          detail =
            "Admin authentication failed. Check the app installation and SHOPIFY_ADMIN_CLIENT_ID/SHOPIFY_ADMIN_CLIENT_SECRET, or the separately supplied SHOPIFY_ADMIN_ACCESS_TOKEN.";
        } else if (status === 403) {
          detail =
            "Admin access denied. Check the app installation and granted API scopes.";
        }
        const message = `${operation}: Shopify${status === undefined ? "" : ` HTTP ${status}`}: ${detail}`;
        if (status === 401 || status === 403 || status === 429) {
          return new DestinationError({
            cause: new ShopifyRequestRejectedError(),
            message,
          });
        }
        return fail(message);
      })
    );
    const envelope = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Struct({
          data: Schema.optionalKey(
            Schema.NullOr(Schema.Record(Schema.String, Schema.Json))
          ),
          errors: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                extensions: Schema.optionalKey(
                  Schema.Struct({ code: Schema.optionalKey(Schema.String) })
                ),
                message: Schema.String,
                path: Schema.optionalKey(Schema.Array(Schema.Json)),
              })
            )
          ),
        })
      )
    )(body).pipe(
      Effect.mapError(() => fail(`${operation}: invalid Admin response`))
    );
    const errors = envelope.errors ?? [];
    if (
      errors.length > 0 ||
      envelope.data === null ||
      envelope.data === undefined
    ) {
      const messages = errors
        .map(({ message }) => message.split(settings.token).join("[REDACTED]"))
        .join("; ");
      const message = `${operation}: Shopify rejected the GraphQL request${messages ? `: ${messages}` : ""}`;
      if (
        (envelope.data === undefined || envelope.data === null) &&
        errors.length > 0 &&
        errors.every(
          ({ extensions, path }) =>
            path === undefined &&
            (extensions?.code === "THROTTLED" ||
              extensions?.code === "ACCESS_DENIED")
        )
      ) {
        return yield* new DestinationError({
          cause: new ShopifyRequestRejectedError(),
          message,
        });
      }
      return yield* fail(message);
    }
    return envelope.data;
  });
  const mutation = Effect.fn("ShopifyCatalog.mutation")(function* (
    operation: string,
    query: string,
    variables: Readonly<Record<string, Schema.Json>>
  ) {
    const data = yield* request(operation, query, variables);
    const payload = yield* Schema.decodeUnknownEffect(
      Schema.Record(Schema.String, Schema.Json)
    )(data[operation]).pipe(
      Effect.mapError(() => fail(`${operation}: missing mutation result`))
    );
    const errors = yield* Schema.decodeUnknownEffect(
      Schema.Array(Schema.Struct({ message: Schema.String }))
    )(payload.userErrors).pipe(
      Effect.mapError(() => fail(`${operation}: invalid mutation errors`))
    );
    if (errors.length > 0) {
      const message = `${operation}: ${errors.map(({ message }) => message).join("; ")}`;
      if (
        (operation === "companyCreate" && payload.company === null) ||
        (operation === "companyLocationCreate" &&
          payload.companyLocation === null)
      ) {
        return yield* new DestinationError({
          cause: new ShopifyCompanyCreateRejectedError(),
          message,
        });
      }
      if (operation === "deliveryProfileUpdate" && payload.profile === null) {
        return yield* new DestinationError({
          cause: new ShopifyDeliveryProfileRejectedError(),
          message,
        });
      }
      return yield* fail(message);
    }
    return payload;
  });
  return { authenticate: Effect.asVoid(settingsSource), mutation, request };
};

export type CatalogAdmin<R = never> = Pick<
  ReturnType<typeof makeCatalogAdmin>,
  "authenticate" | "request"
> & {
  readonly mutation: (
    ...args: Parameters<ReturnType<typeof makeCatalogAdmin>["mutation"]>
  ) => Effect.Effect<Record<string, Schema.Json>, DestinationError, R>;
};

const ShopifyMutation = DestinationChangeDescriptor.make(
  "shopify-admin-mutation@v1",
  Schema.Struct({
    operation: Schema.String,
    resourceIds: Schema.Array(Schema.String),
  })
);

const resourceIds = (value: Schema.Json): readonly string[] =>
  Array.from(
    JSON.stringify(value).matchAll(
      /"(?<id>gid:\/\/shopify\/[A-Za-z][A-Za-z0-9]*\/\d+)"/gu
    ),
    (match) => match.groups?.id
  ).filter((id) => id !== undefined);

export const recordShopifyChange = (
  operation: string,
  variables: Readonly<Record<string, Schema.Json>>,
  payload: Schema.Json
) =>
  Tracking.recordChange(ShopifyMutation, {
    operation,
    resourceIds: [
      ...new Set([...resourceIds(variables), ...resourceIds(payload)]),
    ],
  }).pipe(
    Effect.mapError(
      (cause) =>
        new DestinationError({
          cause,
          message: `Cannot journal acknowledged Shopify mutation ${operation}`,
        })
    )
  );

export const journalCatalogAdmin = (
  admin: CatalogAdmin
): CatalogAdmin<Tracking> => ({
  authenticate: admin.authenticate,
  mutation: Effect.fn("ShopifyCatalog.journalMutation")(
    function* (operation, query, variables) {
      const payload = yield* admin.mutation(operation, query, variables);
      yield* recordShopifyChange(operation, variables, payload);
      return payload;
    }
  ),
  request: admin.request,
});
