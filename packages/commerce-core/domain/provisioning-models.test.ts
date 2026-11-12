import { describe, expect, it } from "@effect/vitest";
import { Redacted, Schema } from "effect";

import { CatalogPriceList as CatalogPriceListJson } from "../catalog/selling";
import { CommerceCustomer } from "./commerce-account";
import { Customer, CustomerInput } from "./customer";
import { CatalogPriceList, CatalogPriceListInput } from "./pricing";

describe("Domain provisioning", () => {
  it("reuses Customer fields in JSON inputs and the existing authenticated runtime projection", () => {
    const input = Schema.decodeUnknownSync(Schema.toCodecJson(CustomerInput))({
      email: "a@example.com",
      firstName: "Alex",
      key: "Customer / 42",
      lastName: "Morgan",
    });
    expect(Redacted.value(input.email)).toBe("a@example.com");
    for (const customerId of [
      "gid://shopify/Customer/42",
      "ct-customer-uuid",
    ]) {
      const customer = Schema.decodeUnknownSync(Schema.toType(Customer))({
        ...input,
        customerId,
      });
      const authenticated = new CommerceCustomer({
        ...customer,
        authUserId: "site-user",
      });
      expect(authenticated.customerId).toBe(customerId);
      expect(Redacted.value(authenticated.email)).toBe("a@example.com");
    }
    expect(() =>
      Schema.decodeUnknownSync(Schema.toCodecJson(CustomerInput))(
        {
          customerId: "native",
          email: "a@example.com",
          firstName: "Alex",
          key: "customer",
          lastName: "Morgan",
        },
        { onExcessProperty: "error" }
      )
    ).toThrow(/Expected|Unexpected/u);
  });

  it("uses the same pricing definition for entities and the existing catalog JSON representation", () => {
    const json = {
      currency: "USD",
      key: "Prices / Dealer A",
      prices: [{ sku: "sku-1", centAmount: 1234 }],
    };
    const input = Schema.decodeUnknownSync(CatalogPriceListInput)(json);
    const entity = Schema.decodeUnknownSync(CatalogPriceList)({
      ...input,
      id: "provider-owned-reference",
    });
    expect(Schema.decodeUnknownSync(CatalogPriceListJson)(json)).toEqual(json);
    expect(Schema.encodeSync(CatalogPriceListInput)(input)).toEqual(json);
    expect(entity.key).toBe(input.key);
    expect(() =>
      Schema.decodeUnknownSync(CatalogPriceListInput)({
        ...json,
        prices: [{ centAmount: Number.MAX_SAFE_INTEGER + 1, sku: "sku-1" }],
      })
    ).toThrow(/Expected|Unexpected/u);
  });
});
