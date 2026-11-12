import { describe, expect, it } from "@effect/vitest";
import { decodeCatalog, validateCatalog } from "@repo/commerce-core/catalog";
import type { CatalogSources } from "@repo/commerce-core/catalog/files";
import { loadCatalog } from "@repo/commerce-core/catalog/files";
import { Effect } from "effect";
import { DestinationError, MigrationExecution } from "migrate-sdk";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import type { CatalogDestination } from "./destination";
import { makeCatalogRegistry } from "./migrations";

const fixture = (catalogs?: CatalogSources) => {
  let currentCatalogs = catalogs;
  const operations: string[] = [];
  const remote = new Map<string, string>();
  let rejectOnce: string | undefined;
  let rejectedSku: string | undefined;
  const destination: CatalogDestination = {
    addCollectionProduct: () => Effect.succeed(undefined),
    addCategories: (name, key, id, categoryIds) =>
      Effect.sync(() => {
        expect(id).toBe(remote.get(key));
        expect(
          categoryIds.every((categoryId) => categoryId.startsWith(`${name}:`))
        ).toBeTruthy();
        return undefined;
      }),
    createImage: (key, image) => Effect.succeed(`file:${key}:${image.url}`),
    assignGallery: (_name, _key, _id, sku) => Effect.succeed(`variant-${sku}`),
    assignReferences: (_name, product, id, relatedIds) =>
      Effect.sync(() => {
        expect(id).toBe(remote.get(product.key));
        expect(relatedIds).toEqual(
          product.relatedProductKeys.map((key) => remote.get(key))
        );
        return undefined;
      }),
    publish: (id) =>
      Effect.sync(() => {
        const product = [...remote].find(([, nativeId]) => nativeId === id);
        if (product) {
          operations.push(`publish:${product[0]}`);
        }
        return undefined;
      }),
    translateCategory: () => Effect.succeed(undefined),
    translateProduct: (_name, product) =>
      Effect.sync(() => {
        operations.push(`translate:${product.key}`);
      }),
    upsertInventory: (_name, _key, _id, sku) =>
      Effect.suspend(() => {
        operations.push(`inventory:${sku}`);
        if (sku === rejectedSku) {
          rejectedSku = undefined;
          return new DestinationError({ message: "Inventory write failed" });
        }
        return Effect.succeed(`inventory-${sku}`);
      }),
    ensureCollection: (name) =>
      Effect.sync(() => {
        operations.push(`${name}:collection`);
        return `${name}-collection`;
      }),
    ensureDefinition: (definition) => Effect.succeed(definition.key),
    ensureLocale: () => Effect.succeed([]),
    ensureStoreAttribution: () => Effect.succeed("attribution"),
    preflight: () =>
      Effect.sync(() => {
        operations.push("preflight");
        return "location";
      }),
    upsertCategory: (name, category) =>
      Effect.sync(() => {
        operations.push(`category:${category.key}`);
        return `${name}:${category.key}`;
      }),
    upsertProduct: (name, product) =>
      Effect.suspend(() => {
        operations.push(`${name}:${product.key}`);
        const id =
          remote.get(product.key) ?? `gid://shopify/Product/${remote.size + 1}`;
        remote.set(product.key, id);
        if (rejectOnce === product.key) {
          rejectOnce = undefined;
          return new DestinationError({
            message: "Simulated response loss after creation",
          });
        }
        return Effect.succeed(id);
      }),
  };
  const store = InMemoryMigrationStore.layer();
  const run = (group: string) =>
    Effect.gen(function* () {
      const registry = makeCatalogRegistry({
        catalogs: currentCatalogs,
        destination,
        store,
      });
      const execution = MigrationExecution.make({ registry });
      const start = yield* execution.run({ group, withDependencies: true });
      if (start.kind === "completed") {
        return start.summary;
      }
      if (start.handle === undefined) {
        return yield* Effect.die("Local execution detached");
      }
      const result = yield* start.handle.wait;
      if (result.kind !== "finished") {
        return yield* Effect.die("Execution did not finish");
      }
      return result.summary;
    });
  return {
    operations,
    rejectNext: (key: string) => {
      rejectOnce = key;
    },
    rejectInventory: (sku: string) => {
      rejectedSku = sku;
    },
    remote,
    run,
    setCatalogs: (nextCatalogs: CatalogSources) => {
      currentCatalogs = nextCatalogs;
    },
  };
};

describe("catalog migrations through Migrate SDK", () => {
  it.effect(
    "updates option translations without republishing when the catalog adds a language",
    () =>
      Effect.gen(function* () {
        const catalog = loadCatalog("b2b");
        const untranslated = decodeCatalog({
          ...catalog,
          categories: catalog.categories.map((category) => ({
            ...category,
            translations: {},
          })),
          products: catalog.products.map((product) => ({
            ...product,
            translations: {},
          })),
        });
        const state = fixture({ equipment: untranslated });
        yield* state.run("equipment");
        const [category] = catalog.categories;
        if (category === undefined) {
          return yield* Effect.die("Missing category");
        }
        state.setCatalogs({
          equipment: {
            ...untranslated,
            categories: [category, ...untranslated.categories.slice(1)],
          },
        });
        yield* state.run("equipment");
        expect(state.remote.size).toBe(4);
        for (const product of catalog.products) {
          expect(
            state.operations.filter(
              (operation) => operation === `translate:${product.key}`
            )
          ).toHaveLength(2);
          expect(
            state.operations.filter(
              (operation) => operation === `publish:${product.key}`
            )
          ).toHaveLength(1);
        }
        const completed = [...state.operations];
        yield* state.run("equipment");
        expect(state.operations).toEqual(completed);
      })
  );

  it.effect(
    "imports an explicitly supplied catalog under its own persistent group name",
    () =>
      Effect.gen(function* () {
        const state = fixture({ gifts: loadCatalog("b2c") });
        yield* state.run("gifts");
        expect(state.remote.size).toBe(4);
        expect(
          state.operations.some((operation) => operation.startsWith("gifts:"))
        ).toBeTruthy();
        const completed = [...state.operations];
        yield* state.run("gifts");
        expect(state.operations).toEqual(completed);
      })
  );

  for (const group of ["b2b", "b2c"] as const) {
    it.effect(
      `imports only ${group}, resolves references, and skips unchanged records on rerun`,
      () =>
        Effect.gen(function* () {
          const state = fixture();
          yield* state.run(group);
          expect(state.operations[0]).toBe("preflight");
          expect(state.remote.size).toBe(4);
          expect(
            state.operations.filter((operation) =>
              operation.startsWith("publish:")
            )
          ).toHaveLength(4);
          const first = [...state.operations];
          yield* state.run(group);
          expect(state.operations).toEqual(first);
        })
    );
  }
  it.effect(
    "retries an ambiguous product creation without duplicating products and completes pending publication",
    () =>
      Effect.gen(function* () {
        const state = fixture();
        state.rejectNext("outdoor-trail-jacket");
        yield* state.run("b2c");
        expect(state.operations).not.toContain("publish:outdoor-trail-jacket");
        yield* state.run("b2c");
        expect(state.remote.size).toBe(4);
        expect(state.operations).toContain("publish:outdoor-trail-jacket");
        expect(
          state.operations.filter((item) => item === "b2c:outdoor-trail-jacket")
        ).toHaveLength(2);
      })
  );

  it.effect(
    "publishes the Product and retries its failed inventory SKU independently",
    () =>
      Effect.gen(function* () {
        const catalog = loadCatalog("b2c");
        const [product] = catalog.products;
        const [{ sku }] = product.variants;
        const state = fixture();
        state.rejectInventory(sku);
        expect((yield* state.run("b2c")).status).toBe("failed");
        expect(state.operations).toContain(`publish:${product.key}`);
        const before = state.operations.length;
        expect((yield* state.run("b2c")).status).toBe("succeeded");
        expect(state.operations.slice(before)).toEqual([`inventory:${sku}`]);
      })
  );

  it("validates missing references and duplicate SKUs before destination execution", () => {
    const { products } = loadCatalog("b2c");
    const [first] = products;
    if (first === undefined) {
      throw new Error("Fixture is empty");
    }
    expect(() =>
      validateCatalog({
        ...loadCatalog("b2c"),
        products: [{ ...first, relatedProductKeys: ["missing"] }],
      })
    ).toThrow(/Missing related/u);
    expect(() =>
      validateCatalog({
        ...loadCatalog("b2c"),
        products: [first, { ...first, key: "another-product" }],
      })
    ).toThrow(/Duplicate catalog SKU/u);
  });
});
