import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeCommerceAuthUserId } from "./commerce-request";

describe("Commerce request input", () => {
  it("decodes a verified external user id", async () => {
    const authUserId = await Effect.runPromise(
      decodeCommerceAuthUserId("auth-user-1")
    );

    expect(authUserId).toBe("auth-user-1");
  });

  it("keeps an anonymous request anonymous", async () => {
    const authUserId = await Effect.runPromise(
      decodeCommerceAuthUserId(undefined)
    );

    expect(authUserId).toBeUndefined();
  });

  it("reports an invalid external user id as a request failure", async () => {
    const error = await Effect.runPromise(
      decodeCommerceAuthUserId("").pipe(Effect.flip)
    );

    expect(error._tag).toBe("CommerceRequestFailure");
  });
});
