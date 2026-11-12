import { getContentstackEndpoint } from "@contentstack/utils";
import { localization } from "@repo/site-config";
import { Effect, Redacted, Schema } from "effect";

import type { ContentstackStack } from "./model";

class ContentstackPreviewError extends Error {}

const PreviewUrl = Schema.Struct({
  locale: Schema.NonEmptyString,
  url: Schema.String,
});
const decodeEnvironment = Schema.decodeUnknownSync(
  Schema.Struct({
    environment: Schema.Struct({
      name: Schema.NonEmptyString,
      urls: Schema.optional(Schema.Array(PreviewUrl)),
    }),
  })
);

export const reconcileContentstackPreviewUrls = ({
  stack,
  region,
  environment,
  frontendOrigin,
}: {
  readonly stack: ContentstackStack;
  readonly region: string;
  readonly environment: string;
  readonly frontendOrigin: string;
}) =>
  Effect.tryPromise({
    catch: (cause) =>
      cause instanceof ContentstackPreviewError
        ? cause
        : new ContentstackPreviewError(
            "Could not reconcile Contentstack environment URLs."
          ),
    try: async (signal) => {
      const origin = URL.parse(frontendOrigin);
      if (
        origin?.protocol !== "https:" ||
        origin.pathname !== "/" ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash
      ) {
        throw new ContentstackPreviewError("Use the storefront HTTPS origin.");
      }
      if (!environment.trim() || environment === "." || environment === "..") {
        throw new ContentstackPreviewError(
          "Specify the web app's Contentstack environment."
        );
      }
      const host = getContentstackEndpoint(region, "contentManagement", true);
      if (typeof host !== "string" || !host || !/^[a-z0-9.-]+$/iu.test(host)) {
        throw new ContentstackPreviewError("Unsupported stack region.");
      }
      const endpoint = new URL(
        `/v3/environments/${encodeURIComponent(environment)}`,
        `https://${host}`
      );
      const headers = {
        api_key: stack.apiKey,
        authorization: Redacted.value(stack.managementToken),
        "content-type": "application/json",
      };
      const request = async (method: "GET" | "PUT", body?: string) => {
        const response = await fetch(endpoint, {
          method,
          body,
          headers,
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) {
          throw new ContentstackPreviewError(
            `Contentstack preview: ${method} environment returned HTTP ${response.status}.`
          );
        }
        const { environment: result } = decodeEnvironment(
          await response.json()
        );
        if (result.name !== environment) {
          throw new ContentstackPreviewError(
            "Environment did not match the request."
          );
        }
        return result.urls ?? [];
      };

      const desired = localization.locales.map((locale) => ({
        locale: locale.toLowerCase(),
        // The default locale is unprefixed in the storefront's next-intl routing.
        url:
          locale === localization.defaultLocale
            ? origin.origin
            : new URL(`/${locale}`, origin).href,
      }));
      const matches = (urls: readonly (typeof PreviewUrl.Type)[]) =>
        desired.every(({ locale, url }) =>
          urls.some(
            (row) =>
              row.locale.toLowerCase() === locale &&
              row.url.replace(/\/$/u, "") === url
          )
        );
      const existing = await request("GET");
      if (!matches(existing)) {
        const locales = new Set(desired.map(({ locale }) => locale));
        await request(
          "PUT",
          JSON.stringify({
            environment: {
              name: environment,
              urls: [
                ...existing.filter(
                  ({ locale }) => !locales.has(locale.toLowerCase())
                ),
                ...desired,
              ],
            },
          })
        );
        if (!matches(await request("GET"))) {
          throw new ContentstackPreviewError(
            "Could not verify the updated URLs."
          );
        }
      }
      return desired;
    },
  });
