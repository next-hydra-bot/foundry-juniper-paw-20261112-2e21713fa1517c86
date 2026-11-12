import { ConfigProvider, Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeCommerceSearchIndexingSource,
  withCompanySearchIndexing,
} from "./search-indexing";

const config = Effect.succeed(
  ConfigProvider.fromUnknown({
    SHOPIFY_ADMIN_ACCESS_TOKEN: "test-token",
    SHOPIFY_STORE_DOMAIN: "demo.myshopify.com",
    SHOPIFY_COMPANY_PURCHASING_POLICIES: JSON.stringify([
      {
        key: "gold-policy",
        label: "Gold",
        currency: "USD",
        locale: "en-US",
        storeKey: "default-store",
        pricingGroupKey: "gold",
        pricingMarketId: "gid://shopify/Market/1",
        pricingCatalogId: "gid://shopify/MarketCatalog/1",
      },
    ]),
  })
);
const decodeRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);

const sourceFixture = (
  publishedLocales = ["en", "es", "fr", "de", "it", "pt-PT", "nl"]
) => {
  const calls: {
    query: string;
    variables: Readonly<Record<string, Schema.Json>>;
  }[] = [];
  const fetchApi: typeof fetch = async (input, init) => {
    const body = decodeRequest(await new Request(input, init).json());
    calls.push(body);
    if (body.query.includes("SearchShopContext")) {
      return Response.json({ data: { shop: { currencyCode: "USD" } } });
    }
    if (body.query.includes("SearchCollectionLocales")) {
      return Response.json({
        data: {
          shopLocales: publishedLocales.map((locale) => ({
            locale,
            published: true,
          })),
        },
      });
    }
    if (body.query.includes("SearchCollections")) {
      return Response.json({
        data: {
          collections: {
            nodes:
              body.variables.after === null
                ? [
                    {
                      legacyResourceId: "42",
                      handle: "outdoor-packs",
                      title: "Outdoor packs",
                      translations:
                        body.variables.locale === "fr"
                          ? [{ key: "title", value: "Sacs de randonnée" }]
                          : [],
                    },
                  ]
                : [
                    {
                      legacyResourceId: "43",
                      handle: "bottles",
                      title: "Bottles",
                      translations: [],
                    },
                  ],
            pageInfo:
              body.variables.after === null
                ? { hasNextPage: true, endCursor: "collections-next" }
                : { hasNextPage: false, endCursor: null },
          },
        },
      });
    }
    return Response.json({
      data: {
        market: {
          status: "ACTIVE",
          catalogs: {
            nodes: [
              {
                id: "gid://shopify/MarketCatalog/1",
                status: "ACTIVE",
                publication: null,
                priceList: { currency: "USD" },
              },
            ],
            pageInfo: { hasNextPage: false },
          },
          conditions: {
            conditionTypes: ["COMPANY_LOCATION"],
            companyLocationsCondition: {
              applicationLevel: "SPECIFIC",
              companyLocations:
                body.variables.after === null
                  ? {
                      nodes: [{ id: "gid://shopify/CompanyLocation/1" }],
                      pageInfo: { hasNextPage: true, endCursor: "next" },
                    }
                  : {
                      nodes: [{ id: "gid://shopify/CompanyLocation/2" }],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
            },
          },
        },
      },
    });
  };
  return { calls, source: makeCommerceSearchIndexingSource(fetchApi) };
};

describe("Shopify search source composition", () => {
  it("keeps B2C free of company API requirements", async () => {
    const fixture = sourceFixture();
    const source = await Effect.runPromise(fixture.source.create(config));
    const categories = await Effect.runPromise(
      source.loadCategories(["fr-FR", "en-US", "en-GB"])
    );
    expect(source).not.toHaveProperty("priceGroups");
    expect(
      fixture.calls.some(({ query }) => query.includes("SearchPricingMarket"))
    ).toBeFalsy();
    expect(categories.get("fr-FR")).toEqual([
      { id: "42", key: "outdoor-packs", label: "Sacs de randonnée" },
      { id: "43", key: "bottles", label: "Bottles" },
    ]);
    expect(categories.get("en-US")).toEqual([
      { id: "42", key: "outdoor-packs", label: "Outdoor packs" },
      { id: "43", key: "bottles", label: "Bottles" },
    ]);
    expect(
      fixture.calls
        .filter(
          ({ query, variables }) =>
            query.includes("SearchCollections") && variables.locale === "en"
        )
        .map(({ variables }) => variables.after)
    ).toEqual([null, "collections-next"]);
  });

  it.each(["b2c", "b2b"])(
    "loads the requested locale on an English-only %s shop",
    async (flavor) => {
      const fixture = sourceFixture(["en"]);
      const source = await Effect.runPromise(
        (flavor === "b2b"
          ? withCompanySearchIndexing(fixture.source)
          : fixture.source
        ).create(config)
      );
      const categories = await Effect.runPromise(
        source.loadCategories(["en-US"])
      );
      expect([...categories.keys()]).toEqual(["en-US"]);
      expect(
        fixture.calls
          .filter(({ query }) => query.includes("SearchCollections"))
          .map(({ variables }) => variables.locale)
      ).toEqual(["en", "en"]);
    }
  );

  it("reports an unpublished requested locale", async () => {
    const fixture = sourceFixture(["en"]);
    const source = await Effect.runPromise(fixture.source.create(config));
    const failure = await Effect.runPromise(
      source.loadCategories(["fr-FR"]).pipe(Effect.flip)
    );
    expect(failure.message).toContain(
      "Enable and publish the Shopify locale for fr-FR"
    );
  });

  it("loads only explicitly bound pricing Markets during B2B provisioning, following membership cursors", async () => {
    const fixture = sourceFixture();
    const source = await Effect.runPromise(
      withCompanySearchIndexing(fixture.source).create(config)
    );
    expect(source).toMatchObject({
      priceGroups: [
        {
          key: "gold",
          companyLocationIds: [
            "gid://shopify/CompanyLocation/1",
            "gid://shopify/CompanyLocation/2",
          ],
        },
      ],
    });
    expect(
      fixture.calls
        .filter(({ query }) => query.includes("SearchPricingMarket"))
        .map(({ variables }) => variables)
    ).toEqual([
      { id: "gid://shopify/Market/1", after: null },
      { id: "gid://shopify/Market/1", after: "next" },
    ]);
  });

  it("requires explicit B2B group bindings and returns a useful configuration error", async () => {
    const fixture = sourceFixture();
    const missing = Effect.succeed(
      ConfigProvider.fromUnknown({
        SHOPIFY_ADMIN_ACCESS_TOKEN: "test-token",
        SHOPIFY_STORE_DOMAIN: "demo.myshopify.com",
      })
    );
    const error = await Effect.runPromise(
      withCompanySearchIndexing(fixture.source)
        .create(missing)
        .pipe(Effect.flip)
    );
    expect(error.message).toContain("SHOPIFY_COMPANY_PURCHASING_POLICIES");
    expect(fixture.calls).toHaveLength(1);
  });
});
