import { afterEach, describe, expect, it, vi } from "vitest";

describe("web development origins", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows the configured storefront hostname without its scheme or port", async () => {
    vi.stubEnv(
      "NEXT_PUBLIC_WEB_URL",
      "https://shopper-tunnel.ngrok-free.app:8443"
    );
    vi.stubEnv("PORTLESS_URL", undefined);
    vi.stubEnv("PORTLESS_NGROK_URL", undefined);

    const { config } = await import("./index");

    expect(config.allowedDevOrigins).toEqual(["shopper-tunnel.ngrok-free.app"]);
  });

  it("allows Portless's exact tunnel host alongside the local storefront", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", "https://web.storefront.localhost:1355");
    vi.stubEnv("PORTLESS_URL", "https://web.storefront.localhost:1355");
    vi.stubEnv("PORTLESS_NGROK_URL", "https://shopper-tunnel.ngrok-free.app");

    const { config } = await import("./index");

    expect(config.allowedDevOrigins).toEqual([
      "web.storefront.localhost",
      "shopper-tunnel.ngrok-free.app",
    ]);
  });

  it("does not turn invalid URLs or non-HTTP schemes into allowed hosts", async () => {
    vi.stubEnv("NEXT_PUBLIC_WEB_URL", undefined);
    vi.stubEnv("PORTLESS_URL", "not-a-url");
    vi.stubEnv("PORTLESS_NGROK_URL", "file:///tmp/tunnel");

    const { config } = await import("./index");

    expect(config.allowedDevOrigins).toEqual([]);
  });
});
