import { describe, expect, it } from "@effect/vitest";
import {
  makeJsonMigration,
  ProvisionedResource,
} from "@repo/cli-core/json-migrations";
import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import { Effect } from "effect";
import { DestinationError, MigrationDefinitionRegistry } from "migrate-sdk";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import { makeTaxDefinition } from "./tax";

describe("Tax provisioning dependency seam", () => {
  it.effect(
    "assigns tax only to Products with successful migration records",
    () =>
      Effect.gen(function* () {
        const store = InMemoryMigrationStore.layer();
        const prerequisite = yield* makeJsonMigration({
          id: "published-catalog",
          group: "catalog",
          store,
          revision: "v1",
          input: {
            schema: ProvisionedResource,
            items: [
              { id: "failed", key: "failed" },
              { id: "ready", key: "ready" },
            ],
            key: (item) => item.key,
          },
          destination: {
            entity: ProvisionedResource,
            reference: (item) => item,
            write: (item) =>
              item.key === "failed"
                ? Effect.fail(
                    new DestinationError({ message: "Product failed" })
                  )
                : Effect.succeed(item),
          },
        });
        const writes: string[] = [];
        const tax = makeTaxDefinition({
          dependencies: [prerequisite],
          products: [
            { definition: prerequisite, key: "failed" },
            { definition: prerequisite, key: "ready" },
          ],
          store,
          revision: ["tax-v1"],
          apply: (products) =>
            Effect.sync(() => {
              writes.push(...products.values());
            }),
        });
        yield* provisionMigrationGroup(
          MigrationDefinitionRegistry.make({
            definitions: [prerequisite, tax],
          }),
          "provision"
        ).pipe(Effect.flip);
        expect(writes).toEqual(["ready"]);
      })
  );

  it.effect(
    "waits for its prerequisite, retries native failures and skips unchanged successful input",
    () =>
      Effect.gen(function* () {
        const store = InMemoryMigrationStore.layer(
          InMemoryMigrationStore.makeState()
        );
        const writes: string[] = [];
        const prerequisite = yield* makeJsonMigration({
          destination: {
            entity: ProvisionedResource,
            reference: (item) => item,
            write: (item) =>
              Effect.sync(() => {
                writes.push("catalog");
                return item;
              }),
          },
          group: "catalog",
          id: "published-catalog",
          input: {
            items: [{ key: "product", id: "product" }],
            key: (item) => item.key,
            schema: ProvisionedResource,
          },
          revision: "v1",
          store,
        });
        let fail = true;
        const tax = makeTaxDefinition({
          apply: (products) =>
            Effect.gen(function* () {
              expect(products.get("product")).toBe("product");
              expect(writes).toContain("catalog");
              writes.push("tax");
              if (fail) {
                return yield* new DestinationError({
                  message: "Native write unavailable",
                });
              }
            }),
          dependencies: [prerequisite],
          products: [{ definition: prerequisite, key: "product" }],
          revision: ["tax-v1"],
          store,
        });
        const registry = MigrationDefinitionRegistry.make({
          definitions: [prerequisite, tax],
        });
        yield* provisionMigrationGroup(registry, "provision").pipe(Effect.flip);
        fail = false;
        yield* provisionMigrationGroup(registry, "provision");
        yield* provisionMigrationGroup(registry, "provision");
        expect(writes).toEqual(["catalog", "tax", "tax"]);
      })
  );
});
