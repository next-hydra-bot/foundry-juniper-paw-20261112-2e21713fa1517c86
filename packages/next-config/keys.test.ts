import { afterEach, describe, expect, it, vi } from "vitest";

import { apiKeys, keys, relatedPreviewOrigin } from "./keys";

describe("application environment requirements", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("validates a standalone storefront without a separate API or Portless", () => {
    vi.stubEnv("PORTLESS_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://store.example");
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);

    expect(keys().NEXT_PUBLIC_WEB_URL).toBe("https://store.example");
  });

  it("accepts binding-only registration and validates an explicitly configured fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    expect(apiKeys().NEXT_PUBLIC_API_URL).toBeUndefined();

    vi.spyOn(console, "error").mockImplementation(() => {});

    vi.stubEnv("NEXT_PUBLIC_API_URL", "invalid");
    expect(() => apiKeys()).toThrow("Invalid environment variables");

    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example");
    expect(apiKeys().NEXT_PUBLIC_API_URL).toBe("https://api.example");
  });
});

it("resolves a selected Git preview and fails closed when only a production alias is available", () => {
  const preview = {
    VERCEL_ENV: "preview",
    RELATED_API_PROJECT_ID: "prj_api",
    VERCEL_RELATED_PROJECTS: JSON.stringify([
      {
        project: { id: "prj_api" },
        preview: { branch: "api-preview.vercel.app" },
        production: { alias: "api.example.com" },
      },
    ]),
  };
  expect(relatedPreviewOrigin("RELATED_API_PROJECT_ID", preview)).toBe(
    "https://api-preview.vercel.app"
  );
  expect(
    relatedPreviewOrigin("RELATED_API_PROJECT_ID", {
      ...preview,
      VERCEL_ENV: "production",
    })
  ).toBeUndefined();
  expect(() =>
    relatedPreviewOrigin("RELATED_API_PROJECT_ID", {
      ...preview,
      VERCEL_RELATED_PROJECTS: JSON.stringify([
        {
          project: { id: "prj_api" },
          production: { alias: "api.example.com" },
        },
      ]),
    })
  ).toThrow("No matching Vercel preview host");
});
