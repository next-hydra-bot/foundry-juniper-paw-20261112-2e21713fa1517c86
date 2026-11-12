import { describe, expect, it } from "vitest";

import { CUSTOMER_COOKIE_NAME, openCustomerSession } from "./session-cookie";

const secret = "test-session-secret-at-least-thirty-two-characters";
const fixture = () => {
  const values = new Map<string, string>();
  const cookies = {
    delete: (name: string) => {
      values.delete(name);
    },
    get: (name: string) =>
      values.has(name) ? { value: values.get(name) ?? "" } : undefined,
    set: (name: string, value: string) => {
      values.set(name, value);
    },
  };
  const open = (scope = "site-session", now = 1000) =>
    openCustomerSession({
      cookies,
      now,
      origin: "https://store.example",
      scope,
      secret,
    });
  return { open, values };
};

describe("Shopify encrypted session storage", () => {
  it("chunks, authenticates and restores SDK session data without exposing tokens", async () => {
    const f = fixture();
    const storage = f.open();
    await storage.manager.setSessionItem("customerAccount", {
      tokens: { accessToken: "private-token".repeat(500) },
    });
    storage.commit();
    expect(f.values.size).toBeGreaterThan(1);
    expect([...f.values.values()].join("")).not.toContain("private-token");
    await expect(
      Promise.resolve(f.open().manager.getSessionItem("customerAccount"))
    ).resolves.toEqual({
      tokens: { accessToken: "private-token".repeat(500) },
    });
    await expect(
      Promise.resolve(
        f.open("another-site-session").manager.getSessionItem("customerAccount")
      )
    ).resolves.toBeUndefined();
    await expect(
      Promise.resolve(
        f
          .open("site-session", 1000 + 8 * 86_400_000)
          .manager.getSessionItem("customerAccount")
      )
    ).resolves.toBeUndefined();
  });

  it("rejects tampered or truncated ciphertext", async () => {
    const f = fixture();
    const storage = f.open();
    await storage.manager.setSessionItem("customerAccount", {
      tokens: "private-token",
    });
    storage.commit();
    const encoded = f.values.get(`${CUSTOMER_COOKIE_NAME}.0`) ?? "";
    f.values.set(
      `${CUSTOMER_COOKIE_NAME}.0`,
      `${encoded.startsWith("A") ? "B" : "A"}${encoded.slice(1)}`
    );
    await expect(
      Promise.resolve(f.open().manager.getSessionItem("customerAccount"))
    ).resolves.toBeUndefined();
    f.values.set(`${CUSTOMER_COOKIE_NAME}.0`, encoded.slice(0, 20));
    await expect(
      Promise.resolve(f.open().manager.getSessionItem("customerAccount"))
    ).resolves.toBeUndefined();
  });
});
