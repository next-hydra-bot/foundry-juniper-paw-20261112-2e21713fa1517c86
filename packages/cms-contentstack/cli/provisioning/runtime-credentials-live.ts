import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";

import { note } from "@repo/cli-core/command-output";
import { routing } from "@repo/i18n/routing";
import { stringifyDocument } from "@urql/core";
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Terminal,
} from "effect";
import type { Effect as EffectType } from "effect";
import { Prompt } from "effect/cli";

import {
  deliveryGraphqlUrl,
  generateContentstackGraphql,
} from "../../scripts/gql-sync";
import {
  ContentstackCredentialInputError,
  ContentstackRuntimeCredentials,
} from "./model";
import { ContentstackRuntimeCredentialInput } from "./runtime-credentials";

export const runContentstackGraphqlGeneration = ({
  apiKey,
  deliveryToken,
  environment,
  host,
}: {
  apiKey: string;
  deliveryToken: string;
  environment: string;
  host: string;
}) =>
  Effect.tryPromise({
    try: () =>
      generateContentstackGraphql(
        deliveryGraphqlUrl(host, apiKey, environment),
        deliveryToken
      ),
    catch: () =>
      new ContentstackCredentialInputError({
        cause: new Error(
          "Check the target stack, delivery credentials, and composed GraphQL documents"
        ),
        message:
          "Could not generate GraphQL files for the target Contentstack stack",
      }),
  });

async function requestRuntimeFile(apiKey: string, environment: string) {
  const input = createInterface({ input: process.stdin, terminal: false });
  try {
    const reply = input[Symbol.asyncIterator]().next();
    process.stdout.write(
      `\nworkspace-contentstack-v1 ${JSON.stringify({ apiKey, environment })}\n`
    );
    const { value } = await reply;
    const result: { path?: unknown } = JSON.parse(value ?? "{}");
    if (typeof result.path !== "string" || !result.path.startsWith("/")) {
      throw new Error("The trusted host did not return a credential file");
    }
    return result.path;
  } finally {
    input.close();
    process.stdin.pause();
  }
}

export const createContentstackRuntimeCredentialInputLayer = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  Layer.effect(
    ContentstackRuntimeCredentialInput,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const terminal = yield* Terminal.Terminal;
      const deliveryTokenConfig = yield* Config.option(
        Config.Redacted("CONTENTSTACK_DELIVERY_TOKEN")
      );
      const previewTokenConfig = yield* Config.option(
        Config.Redacted("CONTENTSTACK_PREVIEW_TOKEN")
      );
      const webhookSecret = yield* Config.option(
        Config.Redacted("CONTENTSTACK_WEBHOOK_SECRET")
      ).pipe(
        Effect.map((configured) =>
          Option.getOrElse(configured, () => Redacted.make(""))
        )
      );
      const configuredDeliveryToken = deliveryTokenConfig.pipe(
        Option.filter((value) => Redacted.value(value).trim().length > 0)
      );
      const configuredPreviewToken = previewTokenConfig.pipe(
        Option.filter((value) => Redacted.value(value).trim().length > 0)
      );
      const homepageSlug = yield* Config.option(
        Config.String("CMS_HOMEPAGE_SLUG")
      );

      return ContentstackRuntimeCredentialInput.of({
        verify: Effect.fn("ContentstackRuntimeCredentialInput.verify")(
          function* (credentials) {
            const { apiKey, deliveryToken, environment, graphqlHost } =
              credentials;
            const token = Redacted.value(deliveryToken);
            yield* runContentstackGraphqlGeneration({
              apiKey,
              deliveryToken: token,
              environment,
              host: graphqlHost,
            });
            const url = deliveryGraphqlUrl(graphqlHost, apiKey, environment);
            const homePath =
              "/" +
              Option.getOrElse(homepageSlug, () => "")
                .trim()
                .replace(/^\/+|\/+$/g, "");
            yield* Effect.tryPromise({
              try: async (signal) => {
                const { landingPageQuery } =
                  await import("../../components/pages/landing-page-query");
                const request = {
                  method: "POST",
                  redirect: "error" as const,
                  signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(30_000),
                  ]),
                  headers: {
                    "Content-Type": "application/json",
                    access_token: token,
                  },
                  body: JSON.stringify({
                    query: stringifyDocument(landingPageQuery),
                    variables: {
                      url: homePath,
                      locale: routing.defaultLocale.toLowerCase(),
                    },
                  }),
                };
                for (let attempt = 0; attempt < 4; attempt++) {
                  if (attempt > 0) await delay(2_000, undefined, { signal });
                  const response = await fetch(url, request);
                  if (!response.ok)
                    return `Contentstack returned HTTP ${response.status} for PageQuery`;
                  const body = await response.json();
                  if (body.errors?.length)
                    return "Contentstack rejected the composed PageQuery. Generate the live schema and check the query fields and fragments";
                  if (
                    body.data?.all_landing_page?.items?.some(
                      (item: { url?: string } | null) => item?.url === homePath
                    )
                  )
                    return null;
                }
                return "PageQuery returned no published homepage in the selected environment";
              },
              catch: () =>
                new ContentstackCredentialInputError({
                  cause: new Error("The composed PageQuery could not run"),
                  message: "Could not verify Contentstack delivery",
                }),
            }).pipe(
              Effect.flatMap((problem) =>
                problem === null
                  ? Effect.void
                  : Effect.fail(
                      new ContentstackCredentialInputError({
                        cause: new Error(problem),
                        message: "Could not verify Contentstack delivery",
                      })
                    )
              )
            );
          }
        ),
        acquire: Effect.fn("ContentstackRuntimeCredentialInput.acquire")(
          function* (apiKey, environment, endpoints) {
            const credentials = (
              deliveryToken: Redacted.Redacted<string>,
              previewToken: Redacted.Redacted<string>
            ) =>
              new ContentstackRuntimeCredentials({
                apiKey,
                deliveryToken,
                environment,
                previewToken,
                webhookSecret,
                graphqlHost: endpoints.graphqlHost,
                graphqlPreviewHost: endpoints.graphqlPreviewHost,
                region: endpoints.region,
              });
            if (
              Option.isSome(configuredDeliveryToken) &&
              Option.isSome(configuredPreviewToken)
            ) {
              return credentials(
                configuredDeliveryToken.value,
                configuredPreviewToken.value
              );
            }

            if (
              Option.isSome(configuredDeliveryToken) ||
              Option.isSome(configuredPreviewToken)
            ) {
              return yield* new ContentstackCredentialInputError({
                cause: new Error(
                  "CONTENTSTACK_DELIVERY_TOKEN and CONTENTSTACK_PREVIEW_TOKEN must be provided together"
                ),
                message:
                  "The configured Contentstack runtime tokens are incomplete",
              });
            }

            if (process.env.WORKSPACE_CONTENTSTACK_BRIDGE === "stdio-v1") {
              const error = () =>
                new ContentstackCredentialInputError({
                  cause: new Error(
                    "The private runtime credential handoff failed"
                  ),
                  message:
                    "Could not load credentials for the target Contentstack stack and environment",
                });
              const runtimeFile = yield* Effect.tryPromise({
                try: () => requestRuntimeFile(apiKey, environment),
                catch: error,
              });
              const values = yield* fileSystem.readFileString(runtimeFile).pipe(
                Effect.mapError(error),
                Effect.flatMap((content) =>
                  Effect.try({ try: () => parseEnv(content), catch: error })
                )
              );
              const deliveryToken = values.CONTENTSTACK_DELIVERY_TOKEN;
              const previewToken = values.CONTENTSTACK_PREVIEW_TOKEN;
              if (
                values.CONTENTSTACK_STACK_API_KEY !== apiKey ||
                values.CONTENTSTACK_ENVIRONMENT !== environment ||
                !deliveryToken?.startsWith("cs") ||
                !previewToken?.startsWith("cs")
              ) {
                return yield* error();
              }
              return credentials(
                Redacted.make(deliveryToken),
                Redacted.make(previewToken)
              );
            }

            const prompt = (tokenType: "Delivery" | "Preview") =>
              Prompt.Password({
                message: `${tokenType} Token for ${environment}`,
                validate: (value) =>
                  value.trim().length === 0
                    ? Effect.fail(`${tokenType} Token cannot be empty`)
                    : Effect.succeed(value),
              });

            yield* note(
              `Create Delivery and Preview Tokens for ${environment} in Contentstack, then enter them below.`
            );
            const tokens = yield* Prompt.run(
              Prompt.all({
                deliveryToken: prompt("Delivery"),
                previewToken: prompt("Preview"),
              })
            ).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.provideService(Terminal.Terminal, terminal),
              Effect.mapError(
                (cause) =>
                  new ContentstackCredentialInputError({
                    cause,
                    message:
                      "Contentstack runtime credential entry was cancelled",
                  })
              )
            );

            return credentials(tokens.deliveryToken, tokens.previewToken);
          }
        ),
      });
    })
  ).pipe(Layer.provide(ConfigProvider.layer(configProvider)));
