import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { catalogByName } from "@repo/commerce-core/catalog/files";
import { Effect, Schema } from "effect";

import { makeCatalogAdmin } from "./admin";
import { provisionCatalogLocales } from "./locales";
import { shopifyCatalogReaders } from "./mapping";

const loadCatalog = (name: string) =>
  catalogByName(shopifyCatalogReaders(), name)();

const catalog = loadCatalog("b2c");
const Request = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);
const fixture = (
  locales = [{ locale: "en", primary: true, published: true }],
  supported = ["en", "fr", "de"]
) => {
  const writes: string[] = [];
  let rejectPublication = false;
  const fetchApi: typeof fetch = async (input, init) => {
    const request = new globalThis.Request(input, init);
    const { query, variables } = Schema.decodeSync(Request)(
      await request.text()
    );
    if (query.includes("query CatalogLocales")) {
      return Response.json({
        data: {
          availableLocales: supported.map((isoCode) => ({ isoCode })),
          shopLocales: locales,
        },
      });
    }
    const locale = Schema.decodeUnknownSync(Schema.String)(variables.locale);
    if (query.includes("shopLocaleEnable(")) {
      expect(locales.some((item) => item.locale === locale)).toBeFalsy();
      const enabled = { locale, primary: false, published: false };
      locales.push(enabled);
      writes.push(`enable:${locale}`);
      return Response.json({
        data: { shopLocaleEnable: { shopLocale: enabled, userErrors: [] } },
      });
    }
    if (query.includes("shopLocaleUpdate(")) {
      expect(variables.shopLocale).toEqual({ published: true });
      writes.push(`publish:${locale}`);
      const enabled = locales.find((item) => item.locale === locale);
      if (enabled === undefined) {
        throw new Error("Locale must be enabled before publishing");
      }
      if (rejectPublication) {
        rejectPublication = false;
        return Response.json({
          data: {
            shopLocaleUpdate: {
              shopLocale: null,
              userErrors: [{ message: "Publication rejected" }],
            },
          },
        });
      }
      enabled.published = true;
      return Response.json({
        data: { shopLocaleUpdate: { shopLocale: enabled, userErrors: [] } },
      });
    }
    throw new Error("Unexpected locale operation");
  };
  return {
    admin: makeCatalogAdmin(
      Effect.succeed({ domain: "example.myshopify.com", token: "test-token" }),
      fetchApi
    ),
    locales,
    rejectNextPublication: () => {
      rejectPublication = true;
    },
    writes,
  };
};

describe("Shopify catalog language provisioning", () => {
  it.effect(
    "enables and publishes French once, preserving unrelated languages and the primary locale",
    () =>
      Effect.gen(function* () {
        const target = fixture([
          { locale: "en", primary: true, published: true },
          { locale: "de", primary: false, published: false },
        ]);
        expect(yield* provisionCatalogLocales(target.admin, catalog)).toEqual([
          { action: "enable-and-publish", locale: "fr" },
        ]);
        expect(yield* provisionCatalogLocales(target.admin, catalog)).toEqual(
          []
        );
        expect(target.writes).toEqual(["enable:fr", "publish:fr"]);
        expect(target.locales).toContainEqual({
          locale: "en",
          primary: true,
          published: true,
        });
        expect(target.locales).toContainEqual({
          locale: "de",
          primary: false,
          published: false,
        });
      })
  );
  it.effect("shows changes without writing in dry-run mode", () =>
    Effect.gen(function* () {
      const target = fixture();
      expect(
        yield* provisionCatalogLocales(target.admin, catalog, { dryRun: true })
      ).toEqual([{ action: "enable-and-publish", locale: "fr" }]);
      expect(target.writes).toEqual([]);
      expect(target.locales).toHaveLength(1);
    })
  );
  it.effect(
    "imports a custom Canadian French catalog with shared English copy",
    () =>
      Effect.gen(function* () {
        const directory = mkdtempSync(join(tmpdir(), "shopify-catalog-"));
        try {
          const file = join(directory, "catalog.json");
          const localized = <
            T extends
              | (typeof catalog.categories)[number]
              | (typeof catalog.products)[number],
          >(
            record: T
          ) => ({
            ...record,
            translations: {
              "en-CA": { title: record.title, description: record.description },
              "fr-CA": { title: "Titre", description: "Description" },
            },
          });
          const custom = {
            ...catalog,
            categories: catalog.categories.map(localized),
            products: catalog.products.map(localized),
          };
          writeFileSync(file, JSON.stringify(custom));
          const read = catalogByName(
            shopifyCatalogReaders({ custom: file }),
            "custom"
          );
          const target = fixture();
          expect(yield* provisionCatalogLocales(target.admin, read())).toEqual([
            { action: "enable-and-publish", locale: "fr" },
          ]);
          expect(target.writes).toEqual(["enable:fr", "publish:fr"]);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      })
  );
  it.effect(
    "resumes publication after a partial failure without enabling the locale again",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        target.rejectNextPublication();
        const error = yield* provisionCatalogLocales(
          target.admin,
          catalog
        ).pipe(Effect.flip);
        expect(error.message).toContain("Publication rejected");
        yield* provisionCatalogLocales(target.admin, catalog, {
          canPublishExisting: true,
        });
        expect(target.writes).toEqual([
          "enable:fr",
          "publish:fr",
          "publish:fr",
        ]);
      })
  );
  it.effect("rejects unsupported languages before writing", () =>
    Effect.gen(function* () {
      const target = fixture(undefined, ["en"]);
      const error = yield* provisionCatalogLocales(target.admin, catalog).pipe(
        Effect.flip
      );
      expect(error.message).toMatch(
        /does not support catalog locale fr-(CA|FR)/u
      );
      expect(target.writes).toEqual([]);
    })
  );
  it.effect("rejects a primary language mismatch before writing", () =>
    Effect.gen(function* () {
      const target = fixture([
        { locale: "fr", primary: true, published: true },
      ]);
      const error = yield* provisionCatalogLocales(target.admin, catalog).pipe(
        Effect.flip
      );
      expect(error.message).toContain(
        "must match the published Shopify primary locale"
      );
      expect(target.writes).toEqual([]);
    })
  );
  it.effect(
    "rejects regional translations that collapse onto one native locale before writing",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        const conflicting = {
          ...catalog,
          categories: catalog.categories.map((category) => ({
            ...category,
            translations: {
              ...category.translations,
              "fr-BE": { description: "Description", title: "Catégorie" },
            },
          })),
        };
        const error = yield* provisionCatalogLocales(
          target.admin,
          conflicting
        ).pipe(Effect.flip);
        expect(error.message).toContain("locale collision");
        expect(target.writes).toEqual([]);
      })
  );
});
