import { describe, expect, it } from "@effect/vitest";
import { AnonymousCommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import { CategorySlug } from "@repo/commerce-core/product/identity";
import { ProductDiscovery } from "@repo/commerce-core/product/product-discovery";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Option } from "effect";
import { vi } from "vitest";

import { guestCommerceContextLayer } from "../testing/commerce-context";
import { storefrontFixture } from "../testing/storefront";
import type { ShopifyRequest } from "../testing/storefront";
import { productDiscoveryLayer } from "./index";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const collection = {
  description: "Sacs pour la journée",
  handle: "sacs",
  id: "gid://shopify/Collection/1",
  title: "Sacs",
};
const run = <A, E>(
  program: Effect.Effect<A, E, ProductDiscovery>,
  respond: Parameters<typeof storefrontFixture>[0]
) =>
  program.pipe(
    Effect.provide(
      productDiscoveryLayer.pipe(
        Layer.provide(
          Layer.merge(
            storefrontFixture(respond),
            guestCommerceContextLayer(
              new AnonymousCommerceContextRequest({
                store: resolveStore({ locale: CommerceLocale.make("fr-FR") }),
              })
            )
          )
        )
      )
    )
  );

describe("Shopify categories", () => {
  it.effect("keeps translated URLs separate from the stable index key", () =>
    Effect.gen(function* () {
      const requests: ShopifyRequest[] = [];
      const result = yield* run(
        ProductDiscovery.pipe(
          Effect.flatMap((discovery) =>
            discovery.findCategoryBySlug(CategorySlug.make("sacs"))
          )
        ),
        (request) => {
          requests.push(request);
          if (request.query.includes("CatalogCategoryKeys")) {
            return Effect.succeed({
              nodes: [{ handle: "outdoor-packs", id: collection.id }],
            });
          }
          return Effect.succeed({ collection });
        }
      );
      expect(Option.getOrNull(result)).toEqual({
        description: collection.description,
        id: collection.id,
        key: "outdoor-packs",
        name: "Sacs",
        slug: "sacs",
      });
      expect(requests[0]?.variables.handle).toBe("sacs");
      expect(requests[0]?.variables.language).toBe("FR");
      expect(requests[1]?.query).toContain("language:null");
      expect(requests[1]?.variables.ids).toEqual([collection.id]);
    })
  );

  it.effect(
    "returns no category when the collection is unpublished or missing",
    () =>
      Effect.gen(function* () {
        const requests: ShopifyRequest[] = [];
        const result = yield* run(
          ProductDiscovery.pipe(
            Effect.flatMap((discovery) =>
              discovery.findCategoryBySlug(CategorySlug.make("missing"))
            )
          ),
          (request) => {
            requests.push(request);
            return Effect.succeed({ collection: null });
          }
        );
        expect(Option.isNone(result)).toBeTruthy();
        expect(requests).toHaveLength(1);
      })
  );

  it.effect(
    "loads every published collection page and resolves keys by ID",
    () =>
      Effect.gen(function* () {
        const pages: (string | undefined)[] = [];
        const second = {
          ...collection,
          handle: "vestes",
          id: "gid://shopify/Collection/2",
          title: "Vestes",
        };
        const categories = yield* run(
          ProductDiscovery.pipe(
            Effect.flatMap((discovery) => discovery.listCategories())
          ),
          (request) => {
            if (request.query.includes("CatalogCategoryKeys")) {
              return Effect.succeed({
                nodes: [collection, second].map(({ id }) => ({
                  handle:
                    id === collection.id ? "outdoor-packs" : "outdoor-clothing",
                  id,
                })),
              });
            }
            const next = request.variables.after === "next";
            pages.push(next ? "next" : undefined);
            return Effect.succeed({
              collections: {
                nodes: [next ? second : collection],
                pageInfo: {
                  endCursor: next ? null : "next",
                  hasNextPage: !next,
                },
              },
            });
          }
        );
        expect(pages).toEqual([undefined, "next"]);
        expect(categories.map(({ key, slug }) => ({ key, slug }))).toEqual([
          { key: "outdoor-packs", slug: "sacs" },
          { key: "outdoor-clothing", slug: "vestes" },
        ]);
      })
  );
});
