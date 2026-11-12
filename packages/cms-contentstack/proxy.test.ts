import { NextRequest } from "next/server";
import { expect, it } from "vitest";

import { cmsProxy } from "./proxy";

it("passes the Contentstack preview hash to the rendering request", () => {
  const request = new NextRequest(
    "https://store.example.test/guides?redirected=true&live_preview=preview-hash"
  );
  const response = cmsProxy(request);

  expect(response?.headers.get("x-middleware-request-x-live-preview")).toBe(
    "preview-hash"
  );
  expect(response?.headers.has("x-live-preview")).toBe(false);
});
