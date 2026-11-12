import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CommerceRuntimeNotConfigured,
  unconfiguredNextCommerceBinding,
} from "./runtime/bindings";

describe("Commerce runtime binding", () => {
  it("fails explicitly when the host does not configure Commerce", async () => {
    const { NextCommerce } = unconfiguredNextCommerceBinding<never, never>();
    await expect(
      NextCommerce.runPromise(Effect.void.pipe(NextCommerce.provide("en-US")))
    ).rejects.toBeInstanceOf(CommerceRuntimeNotConfigured);
  });
});
