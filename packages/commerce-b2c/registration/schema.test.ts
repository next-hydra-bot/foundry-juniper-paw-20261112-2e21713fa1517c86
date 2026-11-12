import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CustomerRegistrationInput } from "./schema";

const input = {
  addressLine1: "100 Main Street",
  addressLine2: "",
  city: "New York",
  country: "US",
  postalCode: "10001",
  reference: "home",
  region: "NY",
};

describe("Customer registration input", () => {
  it("accepts the B2B contact/address fields without requiring company fields", () => {
    const result = Schema.decodeUnknownSync(CustomerRegistrationInput)({
      ...input,
      authUserId: "spoof",
      companyName: "not used",
      email: "untrusted@example.com",
      firstName: " Grace ",
      lastName: "Hopper",
    });
    expect(result.firstName).toBe("Grace");
    expect(result).not.toHaveProperty("companyName");
    expect(result).not.toHaveProperty("authUserId");
    expect(result).not.toHaveProperty("email");
  });
});
