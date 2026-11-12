import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import { makeCatalogAdmin } from "./admin";

const settings = Effect.succeed({
  domain: "example.myshopify.com",
  token: "admin-secret",
});

describe("Shopify provisioning Admin diagnostics", () => {
  it.effect(
    "identifies a rejected Admin token without exposing credentials",
    () =>
      Effect.gen(function* () {
        const admin = makeCatalogAdmin(
          settings,
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              Response.json(
                { errors: "Invalid API key or access token admin-secret" },
                { status: 401 }
              )
            )
        );
        const error = yield* admin
          .request("ProvisionCustomers", "query { shop { id } }")
          .pipe(Effect.flip);
        expect(error.message).toContain("HTTP 401");
        expect(error.message).toContain("SHOPIFY_ADMIN_ACCESS_TOKEN");
        expect(JSON.stringify(error)).not.toContain("admin-secret");
      })
  );

  it.effect("preserves GraphQL access errors and redacts credentials", () =>
    Effect.gen(function* () {
      const admin = makeCatalogAdmin(
        settings,
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            data: null,
            errors: [{ message: "Access denied for customers. admin-secret" }],
          })
        )
      );
      const error = yield* admin
        .request("ProvisionCustomers", "query { customers { nodes { id } } }")
        .pipe(Effect.flip);
      expect(error.message).toContain("Access denied for customers.");
      expect(error.message).not.toContain("admin-secret");
    })
  );
});
