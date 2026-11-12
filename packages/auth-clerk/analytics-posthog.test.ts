import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("optional PostHog server", () => {
  it.each([
    [undefined, undefined],
    ["", ""],
    ["phc_test", undefined],
    [undefined, "https://example.com"],
  ])("does not initialize without both settings", async (key, host) => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", key);
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", host);
    const { analytics } = await import("../analytics/posthog/server");
    expect(analytics).toBeUndefined();
  });

  it("initializes with the configured key and host", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://example.com");
    const { analytics } = await import("../analytics/posthog/server");
    expect(analytics).toBeDefined();
    await analytics?.shutdown();
  });

  it("rejects invalid configured values", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "invalid");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://example.com");
    await expect(import("../analytics/posthog/server")).rejects.toThrow();
  });
});
