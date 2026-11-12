import { beforeEach, describe, expect, it, vi } from "vitest";

const { setRequestLocale, notFound } = vi.hoisted(() => ({
  setRequestLocale: vi.fn(),
  notFound: vi.fn((): never => { throw new Error("not found"); }),
}));

vi.mock("@repo/cms/components/page", () => ({ Page: () => null }));
vi.mock("@repo/i18n", () => ({
  hasLocale: (locales: string[], locale: string) => locales.includes(locale),
  setRequestLocale,
}));
vi.mock("@repo/i18n/routing", () => ({ routing: { locales: ["en-US", "fr-FR"] } }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/env", () => ({ env: { CMS_HOMEPAGE_SLUG: "home" } }));

import Page from "./page";

describe("CMS catch-all page", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["en-US", "fr-FR"])("passes the %s locale separately from the CMS path", async (locale) => {
    const result = await Page({ params: Promise.resolve({ locale, url: ["learn", "pet-care"] }), searchParams: Promise.resolve({}) });

    expect(setRequestLocale).toHaveBeenCalledWith(locale);
    expect(result.props).toMatchObject({ url: "/learn/pet-care", locale });
  });

  it("resolves a localized root to the homepage", async () => {
    const result = await Page({ params: Promise.resolve({ locale: "fr-FR" }), searchParams: Promise.resolve({}) });

    expect(result.props).toMatchObject({ url: "/home", locale: "fr-FR" });
  });

  it("rejects an unsupported locale before rendering", async () => {
    await expect(Page({ params: Promise.resolve({ locale: "invalid", url: ["about"] }), searchParams: Promise.resolve({}) })).rejects.toThrow("not found");
    expect(setRequestLocale).not.toHaveBeenCalled();
  });
});
