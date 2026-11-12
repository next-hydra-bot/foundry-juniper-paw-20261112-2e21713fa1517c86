import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import type { CatalogAdmin } from "../catalog/admin";
import { catalogWebhookTopics } from "../product/event";
import { provisionCatalogWebhooks } from "./webhooks";

const origin = "https://store.example.com";
const uri = `${origin}/api/commerce/catalog-events`;
const fixture = (
  nodes: readonly {
    readonly id: string;
    readonly topic: string;
    readonly uri: string;
    readonly filter?: string | null;
    readonly format?: string;
    readonly includeFields?: readonly string[];
  }[] = []
) => {
  const mutations: string[] = [];
  const admin: CatalogAdmin = {
    authenticate: Effect.void,
    mutation: (_operation, _query, variables) => {
      mutations.push(
        Schema.decodeUnknownSync(Schema.String)(variables.topic ?? variables.id)
      );
      return Effect.succeed({
        userErrors: [],
        webhookSubscription: { id: "created" },
      });
    },
    request: () =>
      Effect.succeed({
        webhookSubscriptions: {
          nodes: nodes.map((node) => ({
            filter: null,
            format: "JSON",
            includeFields: [],
            ...node,
          })),
          pageInfo: { endCursor: null, hasNextPage: false },
        },
      }),
  };
  return { admin, mutations };
};

describe("Catalog webhook provisioning", () => {
  it.effect(
    "repairs filters and partial payloads only at the owned destination",
    () =>
      Effect.gen(function* () {
        const { admin, mutations } = fixture([
          {
            filter: "vendor:example",
            id: "filtered",
            includeFields: ["title"],
            topic: "PRODUCTS_UPDATE",
            uri,
          },
          {
            id: "other-origin",
            topic: "PRODUCTS_DELETE",
            uri: "https://other.example.com/events",
          },
        ]);
        const result = yield* provisionCatalogWebhooks(admin, {
          dryRun: false,
          origin,
        });
        expect(
          result.changes.find(({ topic }) => topic === "PRODUCTS_UPDATE")
            ?.action
        ).toBe("updated");
        expect(mutations).toContain("filtered");
        expect(mutations).not.toContain("other-origin");
      })
  );

  it.effect(
    "provisions missing topics while preserving an existing exact subscription",
    () =>
      Effect.gen(function* () {
        const { admin, mutations } = fixture([
          { id: "existing", topic: "PRODUCTS_UPDATE", uri },
        ]);
        const result = yield* provisionCatalogWebhooks(admin, {
          dryRun: false,
          origin,
        });
        expect(result.uri).toBe(uri);
        expect(mutations).not.toContain("PRODUCTS_UPDATE");
        expect(mutations).toHaveLength(
          Object.keys(catalogWebhookTopics).length - 1
        );
      })
  );
  it.effect("makes a completed setup idempotent", () =>
    Effect.gen(function* () {
      const { admin, mutations } = fixture(
        Object.keys(catalogWebhookTopics).map((topic) => ({
          id: topic,
          topic,
          uri,
        }))
      );
      const result = yield* provisionCatalogWebhooks(admin, {
        dryRun: false,
        origin,
      });
      expect(mutations).toEqual([]);
      expect(
        result.changes.every(({ action }) => action === "unchanged")
      ).toBeTruthy();
    })
  );
  it.effect(
    "dry run plans subscriptions without mutations and rejects non-origin destinations",
    () =>
      Effect.gen(function* () {
        const { admin, mutations } = fixture();
        const result = yield* provisionCatalogWebhooks(admin, {
          dryRun: true,
          origin,
        });
        expect(
          result.changes.every(({ action }) => action === "would-create")
        ).toBeTruthy();
        expect(mutations).toEqual([]);
        const invalid = yield* provisionCatalogWebhooks(admin, {
          dryRun: false,
          origin: `${origin}/path`,
        }).pipe(Effect.result);
        expect(invalid._tag).toBe("Failure");
      })
  );
});
