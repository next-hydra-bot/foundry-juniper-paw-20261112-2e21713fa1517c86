import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { prepareRedirectTheme } from "./redirect-theme";

describe("redirect theme preparation", () => {
  it("preserves source/settings, prepares a separate copy and verifies replays", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "redirect-theme-test-"));
    try {
      const source = path.join(root, "source");
      await mkdir(path.join(source, "config"), { recursive: true });
      await mkdir(path.join(source, "layout"));
      await writeFile(
        path.join(source, "config/settings_schema.json"),
        JSON.stringify([{ settings: [{ id: "storefront_hostname" }] }])
      );
      const settings = JSON.stringify({
        current: {
          storefront_hostname: "old.example.com",
          custom_redirects: "/old > /new",
          integrate_with_customer_accounts: true,
        },
      });
      await writeFile(path.join(source, "config/settings_data.json"), settings);
      await writeFile(
        path.join(source, "layout/theme.liquid"),
        "{{ content_for_layout }}"
      );
      const options = {
        source,
        output: path.join(root, "prepared"),
        origin: "https://frontend.example.com",
        dryRun: false,
      };
      const dry = await Effect.runPromise(
        prepareRedirectTheme({ ...options, dryRun: true })
      );
      expect(dry.dryRun).toBe(true);
      await expect(
        readFile(path.join(options.output, "config/settings_data.json"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      await Effect.runPromise(prepareRedirectTheme(options));
      expect(
        await readFile(path.join(source, "config/settings_data.json"), "utf8")
      ).toBe(settings);
      const configured = JSON.parse(
        await readFile(
          path.join(options.output, "config/settings_data.json"),
          "utf8"
        )
      );
      expect(configured.current).toEqual({
        storefront_hostname: "frontend.example.com",
        custom_redirects: "/old > /new",
        integrate_with_customer_accounts: true,
      });
      expect(
        (await Effect.runPromise(prepareRedirectTheme(options))).idempotent
      ).toBe(true);
      await writeFile(
        path.join(options.output, "layout/theme.liquid"),
        "changed"
      );
      await expect(
        Effect.runPromise(prepareRedirectTheme(options))
      ).rejects.toThrow(/changed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("rejects unsupported redirect origins before writing", async () => {
    for (const origin of [
      "http://example.com",
      "https://user:pass@example.com",
      "https://example.com/path",
      "https://example.com:444",
    ]) {
      await expect(
        Effect.runPromise(
          prepareRedirectTheme({
            source: "/unused",
            output: "/unused-output",
            origin,
            dryRun: false,
          })
        )
      ).rejects.toThrow(/HTTPS origin/);
    }
  });
});
