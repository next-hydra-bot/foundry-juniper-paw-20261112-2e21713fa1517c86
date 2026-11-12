import { describe, expect, it } from "vitest";

import { GET } from "./route-handlers";

describe("Shopify logout document navigation", () => {
  it.each(["continue", "complete"])(
    "does not enter the one-use %s workflow during a Next.js background request",
    async (step) => {
      const response = await GET(
        new Request(`https://store.example/account/logout/${step}`, {
          headers: { rsc: "1", "sec-fetch-dest": "empty" },
        })
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  );
});

describe("Shopify sign-in document navigation", () => {
  it.each(["login", "refresh", "authorize"])(
    "does not start %s authentication during a Next.js background request",
    async (step) => {
      const response = await GET(
        new Request(
          `https://store.example/account/${step}?purpose=account&return_to=/en-US/account/shopping-lists`,
          {
            headers: { rsc: "1", "sec-fetch-dest": "empty" },
          }
        )
      );
      expect(response.status).toBe(409);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  );
});
