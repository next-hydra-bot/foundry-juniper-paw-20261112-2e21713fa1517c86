import { localization } from "@repo/site-config";
import { Effect, Redacted } from "effect";
import { afterEach, expect, it, vi } from "vitest";

import { ContentstackApiKey, ContentstackStack } from "./model";
import { reconcileContentstackPreviewUrls } from "./preview";

const stack = new ContentstackStack({
  apiKey: ContentstackApiKey.make("stack-id"),
  managementToken: Redacted.make("private-management-token"),
  managementTokenAlias: "stack-alias",
});
const frontendOrigin = "https://store.example.test";
const environment = "development";
const options = { stack, region: "EU", environment, frontendOrigin };
const other = { locale: "zz", url: "https://other.example.test" };
const expected = localization.locales.map((locale) => ({
  locale: locale.toLowerCase(),
  url:
    locale === localization.defaultLocale
      ? frontendOrigin
      : `${frontendOrigin}/${locale}`,
}));

function result(urls: readonly { locale: string; url: string }[]) {
  return Response.json({ environment: { name: environment, urls } });
}

afterEach(() => vi.unstubAllGlobals());

it("updates the active environment's locale URLs and verifies the result", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      result([
        {
          locale: localization.defaultLocale.toLowerCase(),
          url: "http://localhost:3000",
        },
        other,
      ])
    )
    .mockResolvedValueOnce(result([other, ...expected]))
    .mockResolvedValueOnce(result([other, ...expected]));
  vi.stubGlobal("fetch", fetch);

  await expect(
    Effect.runPromise(reconcileContentstackPreviewUrls(options))
  ).resolves.toEqual(expected);
  expect(
    fetch.mock.calls.map(([url, init]) => [String(url), init?.method])
  ).toEqual(
    ["GET", "PUT", "GET"].map((method) => [
      "https://eu-api.contentstack.com/v3/environments/development",
      method,
    ])
  );
  expect(fetch.mock.calls[1]?.[1]?.body).toBe(
    JSON.stringify({
      environment: { name: environment, urls: [other, ...expected] },
    })
  );
});

it("keeps existing URLs when the composed locale mappings already match", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      result([
        other,
        ...expected.map((entry) => ({ ...entry, url: `${entry.url}/` })),
      ])
    );
  vi.stubGlobal("fetch", fetch);

  await expect(
    Effect.runPromise(reconcileContentstackPreviewUrls(options))
  ).resolves.toEqual(expected);
  expect(fetch).toHaveBeenCalledTimes(1);
});
