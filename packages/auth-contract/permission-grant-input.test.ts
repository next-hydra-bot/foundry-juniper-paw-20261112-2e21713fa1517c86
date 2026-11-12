import { jsonInputSchema } from "@repo/cli-core/json-migrations";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { permissionGrantInputFor } from "./permission-grant-input";

describe("Permission Grant source vocabulary", () => {
  const grant = {
    authUserKey: "manager",
    key: "warehouse-access",
    permissions: ["company.members.invite"],
    scope: { key: "warehouse", type: "business-unit" },
  };

  it("derives the input vocabulary from the selected manifest", () => {
    const schema = permissionGrantInputFor(["company.members.invite"] as const);
    expect(Schema.decodeUnknownSync(schema)(grant).permissions).toEqual([
      "company.members.invite",
    ]);
    expect(() =>
      Schema.decodeUnknownSync(schema)({
        ...grant,
        permissions: ["registration.review"],
      })
    ).toThrow(/Expected/u);
  });

  it("keeps an empty storefront manifest from accepting Admin permissions", () => {
    const schema = permissionGrantInputFor([]);
    expect(
      Schema.decodeUnknownSync(schema)({ ...grant, permissions: [] })
        .permissions
    ).toEqual([]);
    expect(() => Schema.decodeUnknownSync(schema)(grant)).toThrow(/Expected/u);
    expect(jsonInputSchema(schema)).toHaveProperty("type", "array");
  });
});
