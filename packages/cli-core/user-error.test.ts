import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { failureMessage, toUserError } from "./user-error";

class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  { cause: Schema.Defect(), message: Schema.String }
) {}

describe("CLI user errors", () => {
  it("renders the reason carried by a wrapped provider error", () => {
    const error = toUserError(
      new ProviderError({
        cause: new Error("Token alias demo is delivery, not management"),
        message: "Could not resolve the Management Token alias demo",
      })
    );

    expect(error.message).toBe(
      "Could not resolve the Management Token alias demo\n  Token alias demo is delivery, not management"
    );
  });

  it("omits repeated messages and non-error causes", () => {
    expect(
      failureMessage(
        new Error("Import failed", {
          cause: new Error("Import failed", { cause: "raw provider body" }),
        })
      )
    ).toBe("Import failed");
    expect(failureMessage("not an error")).toBeUndefined();
  });
});
