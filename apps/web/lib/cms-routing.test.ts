import { describe, expect, it } from "vitest";

import { resolveCmsPagePath } from "./cms-routing";

describe(resolveCmsPagePath, () => {
  it.each([
    [["about"], "/about"],
    [["learn", "pet-care"], "/learn/pet-care"],
    ["about", "/about"],
    ["learn/pet-care", "/learn/pet-care"],
    ["/about", "/about"],
    ["/learn/pet-care/", "/learn/pet-care/"],
    ["/", "/"],
    ["//about", "//about"],
    [["about", ""], "/about/"],
    ["hello%20world", "/hello%20world"],
  ] as const)("resolves %j to %s", (url, expected) => {
    expect(resolveCmsPagePath(url, "home")).toBe(expected);
  });

  it.each([undefined, "", []] as const)(
    "uses the configured homepage for root input %j",
    (url) => {
      expect(resolveCmsPagePath(url, " /home/ ")).toBe("/home");
    }
  );

  it.each(["", " ", "/", "///"])(
    "uses / for an empty homepage slug %j",
    (slug) => {
      expect(resolveCmsPagePath(undefined, slug)).toBe("/");
    }
  );

  it.each(["%%drp:url:%%", "%%drp:url:0123abcdef%%", ["%%drp:url:abc%%"]] as const)(
    "uses the homepage for Next dynamic route placeholder %j",
    (url) => {
      expect(resolveCmsPagePath(url, "/home/")).toBe("/home");
    }
  );

  it.each(["%%drp:url:ABC%%", "/%%drp:url:abc%%", "%%drp:url:abc%%/child"])(
    "does not treat non-matching placeholder %j as the root",
    (url) => {
      expect(resolveCmsPagePath(url, "home")).toBe(
        url.startsWith("/") ? url : `/${url}`
      );
    }
  );
});
