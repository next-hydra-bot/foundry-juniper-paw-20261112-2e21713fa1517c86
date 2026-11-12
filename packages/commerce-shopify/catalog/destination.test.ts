import { expect, layer } from "@effect/vitest";
import { CatalogProduct } from "@repo/commerce-core/catalog";
import { catalogByName } from "@repo/commerce-core/catalog/files";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { attributeDefinitions } from "../product/attributes";
import { OptionBindings } from "../product/options";
import {
  catalogMetafieldDefinitions,
  makeCatalogDestination,
} from "./destination";
import type { ProductResource } from "./destination";
import { shopifyCatalogReaders, catalogTranslationLocales } from "./mapping";
import { productImages } from "./media";
import { testTracking } from "./tracking.test-fixture";

vi.mock(
  "@repo/site-config/localization",
  () => import("@repo/site-config/test-localization")
);

const settings = {
  domain: "example.myshopify.com",
  locationId: "gid://shopify/Location/1",
  publicationId: "gid://shopify/Publication/1",
  token: "admin-secret",
};
const storeAttributionDefinition = {
  capabilities: {
    adminFilterable: { enabled: true },
    cartToOrderCopyable: { enabled: true },
  },
  id: "gid://shopify/MetafieldDefinition/1",
  key: "store_key",
  namespace: "commerce",
  ownerType: "ORDER",
  type: { name: "single_line_text_field" },
};
const fields = (nodes: ProductResource["metafields"]["nodes"] = []) => ({
  nodes,
  pageInfo: { hasNextPage: false },
});
const loadCatalog = (name: string) =>
  catalogByName(shopifyCatalogReaders(), name)();

const product = loadCatalog("b2c").products.find(
  (item) => item.key === "outdoor-insulated-bottle"
);
if (product === undefined) {
  throw new Error("Missing catalog fixture");
}
const bottle = product;
const lift = loadCatalog("b2b").products.find(
  (item) => item.key === "equipment-mobile-lift"
);
if (lift === undefined) {
  throw new Error("Missing translated equipment fixture");
}
const mobileLift = lift;
const Request = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);
const FileInput = Schema.Struct({
  alt: Schema.String,
  filename: Schema.optionalKey(Schema.String),
  id: Schema.optionalKey(Schema.String),
  originalSource: Schema.optionalKey(Schema.String),
});
const ProductInput = Schema.Struct({
  files: Schema.Array(FileInput),
  metafields: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      namespace: Schema.String,
      type: Schema.String,
      value: Schema.String,
    })
  ),
  productOptions: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      position: Schema.optionalKey(Schema.Int),
      values: Schema.Array(Schema.Struct({ name: Schema.String })),
    })
  ),
  tags: Schema.Array(Schema.String),
  variants: Schema.Array(
    Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      metafields: Schema.Array(
        Schema.Struct({
          key: Schema.String,
          namespace: Schema.String,
          type: Schema.String,
          value: Schema.String,
        })
      ),
      optionValues: Schema.Array(
        Schema.Struct({ name: Schema.String, optionName: Schema.String })
      ),
      sku: Schema.String,
    })
  ),
});

const ensureCatalogSetup = (
  destination: ReturnType<typeof makeCatalogDestination>,
  name: "b2b" | "b2c",
  ids = new Map<string, string>()
) =>
  Effect.gen(function* () {
    yield* destination.preflight(name);
    for (const locale of catalogTranslationLocales(loadCatalog(name))) {
      yield* destination.ensureLocale(name, locale, false);
    }
    ids.set(
      "store_key",
      yield* destination.ensureStoreAttribution(ids.get("store_key"))
    );
    for (const definition of catalogMetafieldDefinitions) {
      const key = `${definition.ownerType}/${definition.namespace}/${definition.key}`;
      ids.set(
        key,
        yield* destination.ensureDefinition(definition, ids.get(key))
      );
    }
  });

const adminFixture = (
  initialLocales: readonly {
    readonly locale: string;
    readonly primary: boolean;
    readonly published: boolean;
  }[] = [
    { locale: "en", primary: true, published: true },
    { locale: "fr", primary: false, published: true },
  ]
) => {
  const shopLocales = initialLocales.map((locale) => ({ ...locale }));
  let attributionConfigured = false;
  let current: ProductResource | null = null;
  let loseResponse = false;
  const members = new Set<string>();
  const files = new Map<
    string,
    { id: string; fileStatus: string; __typename: string }
  >();
  const collections = new Map<
    string,
    { id: string; owner: { value: string }; category: { value: string } | null }
  >();
  const translations: Schema.Json[] = [];
  const translationWrites: { id: string; translations: Schema.Json }[] = [];
  let nativeOptions: {
    id: string;
    name: string;
    position: number;
    optionValues: { id: string; name: string }[];
  }[] = [];
  let nativeVariants: {
    sku: string;
    selectedOptions: { optionValue: { id: string } }[];
  }[] = [];
  const metafieldWrites: Schema.Json[] = [];
  let missingOptionDigest = false;
  let rejectOptionTranslation = false;
  const definitions = new Map<
    string,
    {
      readonly id: string;
      readonly key: string;
      readonly namespace: string;
      readonly ownerType: string;
      readonly type: { readonly name: string };
      readonly access: { readonly storefront: string };
    }
  >();
  let pendingImages = false;
  const writes: string[] = [];
  const inputs: (typeof ProductInput.Type)[] = [];
  const translationResponse = (
    query: string,
    variables: Readonly<Record<string, Schema.Json>>
  ): Schema.Json | undefined => {
    if (query.includes("CatalogOptionBindings(")) {
      return {
        product: {
          options: nativeOptions,
          variants: { nodes: nativeVariants, pageInfo: { hasNextPage: false } },
        },
      };
    }
    if (query.includes("query CatalogTranslation(")) {
      const id = Schema.decodeUnknownSync(Schema.String)(variables.id);
      let content = [
        { digest: "title-digest", key: "title" },
        { digest: "body-digest", key: "body_html" },
      ];
      if (id.includes("/ProductOption")) {
        content = missingOptionDigest
          ? []
          : [{ digest: `${id}:name`, key: "name" }];
      }
      return {
        shopLocales: [...shopLocales],
        translatableResource: { translatableContent: content },
      };
    }
    if (query.includes("translationsRegister(")) {
      const id = Schema.decodeUnknownSync(Schema.String)(variables.id);
      translations.push(variables.translations ?? null);
      translationWrites.push({
        id,
        translations: variables.translations ?? null,
      });
      writes.push("translationsRegister");
      const reject = rejectOptionTranslation && id.includes("/ProductOption");
      if (reject) {
        rejectOptionTranslation = false;
      }
      return {
        translationsRegister: {
          userErrors: reject
            ? [{ message: "Option translation rejected" }]
            : [],
        },
      };
    }
    return undefined;
  };
  const provisioningResponse = (
    query: string,
    variables: Readonly<Record<string, Schema.Json>>
  ): Schema.Json | undefined => {
    if (query.includes("query CatalogLocales")) {
      return {
        availableLocales: ["en", "fr"].map((isoCode) => ({ isoCode })),
        shopLocales,
      };
    } else if (query.includes("shopLocaleEnable(")) {
      const enabled = {
        locale: Schema.decodeUnknownSync(Schema.String)(variables.locale),
        primary: false,
        published: false,
      };
      shopLocales.push(enabled);
      writes.push("shopLocaleEnable");
      return { shopLocaleEnable: { shopLocale: enabled, userErrors: [] } };
    } else if (query.includes("shopLocaleUpdate(")) {
      const locale = shopLocales.find(
        (item) => item.locale === variables.locale
      );
      if (locale === undefined) {
        throw new Error("Cannot publish a missing locale");
      }
      locale.published = true;
      writes.push("shopLocaleUpdate");
      return { shopLocaleUpdate: { shopLocale: locale, userErrors: [] } };
    } else if (query.includes("query StoreAttributionDefinition")) {
      return {
        metafieldDefinition: attributionConfigured
          ? storeAttributionDefinition
          : null,
      };
    } else if (query.includes("metafieldDefinitions(")) {
      return {
        metafieldDefinitions: {
          nodes: [...definitions.values()].filter(
            (definition) =>
              definition.ownerType === variables.owner &&
              definition.namespace === variables.namespace
          ),
        },
      };
    } else if (query.includes("metafieldDefinitionCreate(")) {
      writes.push("metafieldDefinitionCreate");
      if (query.includes("CreateStoreAttribution")) {
        attributionConfigured = true;
        return {
          metafieldDefinitionCreate: {
            createdDefinition: storeAttributionDefinition,
            userErrors: [],
          },
        };
      }
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          key: Schema.String,
          namespace: Schema.String,
          ownerType: Schema.String,
          type: Schema.String,
        })
      )(variables.definition);
      const definition = {
        ...input,
        access: { storefront: "PUBLIC_READ" },
        id: `gid://shopify/MetafieldDefinition/${definitions.size + 2}`,
        type: { name: input.type },
      };
      definitions.set(
        `${input.ownerType}/${input.namespace}/${input.key}`,
        definition
      );
      return {
        metafieldDefinitionCreate: {
          createdDefinition: definition,
          userErrors: [],
        },
      };
    }
    return undefined;
  };
  const fetchApi: typeof fetch = async (url, init) => {
    expect(new globalThis.Request(url, init).url).toBe(
      "https://example.myshopify.com/admin/api/2026-10/graphql.json"
    );
    expect(new Headers(init?.headers).get("X-Shopify-Access-Token")).toBe(
      "admin-secret"
    );
    const { query, variables } = Schema.decodeUnknownSync(Request)(
      await new Response(init?.body).text()
    );
    const translation =
      translationResponse(query, variables) ??
      provisioningResponse(query, variables);
    if (translation !== undefined) {
      return Response.json({ data: translation });
    }
    let data: Schema.Json;
    if (query.includes("CatalogTarget")) {
      data = {
        location: { id: settings.locationId, isActive: true },
        publication: { id: settings.publicationId },
        shop: { currencyCode: "USD" },
        shopLocales: [...shopLocales],
      };
    } else if (query.includes("CatalogImageCreate")) {
      const [file] = Schema.decodeUnknownSync(
        Schema.Tuple([
          Schema.Struct({
            filename: Schema.String,
            originalSource: Schema.String,
          }),
        ])
      )(variables.files);
      const native = {
        __typename: "MediaImage",
        id: `gid://shopify/MediaImage/${files.size + 1}`,
        fileStatus: "READY",
      };
      files.set(file.filename, native);
      data = { fileCreate: { files: [native], userErrors: [] } };
    } else if (query.includes("CatalogImageStatus")) {
      const file = [...files.values()].find(({ id }) => id === variables.id);
      data = {
        node: file
          ? {
              ...file,
              fileStatus: pendingImages ? "PROCESSING" : file.fileStatus,
            }
          : null,
      };
    } else if (query.includes("collectionByHandle")) {
      const handle = Schema.decodeUnknownSync(Schema.String)(variables.handle);
      const collection = collections.get(handle);
      data = {
        collectionByHandle:
          collection === undefined
            ? null
            : { ...collection, metafield: collection.owner },
      };
    } else if (query.includes("collectionCreate(")) {
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          handle: Schema.String,
          metafields: Schema.Array(
            Schema.Struct({ key: Schema.String, value: Schema.String })
          ),
        })
      )(variables.input);
      const category = input.metafields.find(
        ({ key }) => key === "seedCategory"
      )?.value;
      const collection = {
        category: category === undefined ? null : { value: category },
        id: `gid://shopify/Collection/${collections.size + 10}`,
        owner: { value: "b2c" },
      };
      collections.set(input.handle, collection);
      writes.push("collectionCreate");
      data = {
        collectionCreate: { collection: { id: collection.id }, userErrors: [] },
      };
    } else if (query.includes("collectionUpdate(")) {
      const input = Schema.decodeUnknownSync(
        Schema.Struct({ id: Schema.String })
      )(variables.input);
      writes.push("collectionUpdate");
      data = {
        collectionUpdate: { collection: { id: input.id }, userErrors: [] },
      };
    } else if (query.includes("productByIdentifier")) {
      data = query.includes("SeedInventoryProduct")
        ? { location: { isActive: true }, product: current }
        : { product: current };
    } else if (query.includes("productSet(")) {
      const input = Schema.decodeUnknownSync(ProductInput)(variables.input);
      inputs.push(input);
      nativeOptions = input.productOptions.map((option, index) => ({
        id: `gid://shopify/ProductOption/${index + 1}`,
        name: option.name,
        optionValues: option.values.map((value, valueIndex) => ({
          id: `gid://shopify/ProductOptionValue/${index * 100 + valueIndex + 1}`,
          name: value.name,
        })),
        position: option.position ?? index + 1,
      }));
      nativeVariants = input.variants.map((variant) => ({
        selectedOptions: variant.optionValues.map((selection) => {
          const option = nativeOptions.find(
            ({ name }) => name === selection.optionName
          );
          const value = option?.optionValues.find(
            ({ name }) => name === selection.name
          );
          if (value === undefined) {
            throw new Error("Invalid fake Shopify option input");
          }
          return { optionValue: { id: value.id } };
        }),
        sku: variant.sku,
      }));
      writes.push("productSet");
      current = {
        id: current?.id ?? "gid://shopify/Product/1",
        metafields: fields(input.metafields),
        tags: input.tags,
        variants: {
          nodes: input.variants.map((variant, index) => ({
            id: variant.id ?? `gid://shopify/ProductVariant/${index + 1}`,
            inventoryItem: current?.variants.nodes[index]?.inventoryItem ?? {
              id: `gid://shopify/InventoryItem/${index + 1}`,
              inventoryLevel: null,
            },
            metafields: fields(variant.metafields),
            sku: variant.sku,
          })),
          pageInfo: { hasNextPage: false },
        },
      };
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Response lost after write");
      }
      data = { productSet: { product: { id: current.id }, userErrors: [] } };
    } else if (query.includes("inventoryActivate(")) {
      if (current === null) {
        throw new Error("Missing product");
      }
      writes.push("inventoryActivate");
      expect(query).toContain("@idempotent(key:$idempotencyKey)");
      expect(variables.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/u);
      const quantity = Schema.decodeUnknownSync(Schema.Int)(
        variables.available
      );
      current = {
        ...current,
        variants: {
          ...current.variants,
          nodes: current.variants.nodes.map((variant) =>
            variant.inventoryItem === undefined
              ? variant
              : {
                  ...variant,
                  inventoryItem: {
                    ...variant.inventoryItem,
                    inventoryLevel: {
                      quantities: [{ name: "available", quantity }],
                    },
                  },
                }
          ),
        },
      };
      data = { inventoryActivate: { userErrors: [] } };
    } else if (query.includes("inventorySetQuantities(")) {
      if (current === null) {
        throw new Error("Missing product");
      }
      expect(query).toContain("@idempotent(key:$idempotencyKey)");
      expect(variables.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/u);
      const input = Schema.decodeUnknownSync(
        Schema.Struct({
          quantities: Schema.Array(
            Schema.Struct({
              changeFromQuantity: Schema.Int,
              quantity: Schema.Int,
            })
          ),
        })
      )(variables.input);
      const [update] = input.quantities;
      if (update === undefined) {
        throw new Error("Missing inventory update");
      }
      expect(update.changeFromQuantity).toBe(
        current.variants.nodes[0]?.inventoryItem?.inventoryLevel?.quantities[0]
          ?.quantity
      );
      current = {
        ...current,
        variants: {
          ...current.variants,
          nodes: current.variants.nodes.map((variant) =>
            variant.inventoryItem === undefined
              ? variant
              : {
                  ...variant,
                  inventoryItem: {
                    ...variant.inventoryItem,
                    inventoryLevel: {
                      quantities: [
                        { name: "available", quantity: update.quantity },
                      ],
                    },
                  },
                }
          ),
        },
      };
      writes.push("inventorySetQuantities");
      data = { inventorySetQuantities: { userErrors: [] } };
    } else if (query.includes("hasProduct")) {
      data = {
        collection: {
          hasProduct: members.has(
            Schema.decodeUnknownSync(Schema.String)(variables.id)
          ),
        },
      };
    } else if (query.includes("collectionAddProducts(")) {
      writes.push("collectionAddProducts");
      const id = Schema.decodeUnknownSync(Schema.String)(variables.id);
      members.add(id);
      data = { collectionAddProducts: { userErrors: [] } };
    } else if (query.includes("publishablePublish(")) {
      writes.push("publishablePublish");
      data = { publishablePublish: { userErrors: [] } };
    } else if (query.includes("metafieldsSet(")) {
      metafieldWrites.push(variables.metafields ?? null);
      writes.push("metafieldsSet");
      data = { metafieldsSet: { userErrors: [] } };
    } else {
      throw new Error(`Unexpected operation: ${query}`);
    }
    return Response.json({ data });
  };
  const destination = makeCatalogDestination({
    fetchApi,
    settings: Effect.succeed(settings),
  });
  const fileIds = new Map<string, string>();
  const schemaIds = new Map<string, string>();
  let productId: string | undefined;
  return {
    destination: {
      ...destination,
      upsertProduct: (name: string, product: typeof CatalogProduct.Type) =>
        Effect.gen(function* () {
          for (const image of productImages(product)) {
            if (!fileIds.has(image.url)) {
              fileIds.set(
                image.url,
                yield* destination.createImage(product.key, image)
              );
            }
          }
          productId = yield* destination.upsertProduct(
            name,
            product,
            fileIds,
            productId
          );
          return productId;
        }),
      ensureDefinitions: (name: "b2b" | "b2c") =>
        ensureCatalogSetup(destination, name, schemaIds),
      completeProduct: (
        name: string,
        product: typeof CatalogProduct.Type,
        id: string,
        collection: string,
        relatedIds: readonly string[],
        categoryIds: readonly string[],
        referenceIds: Readonly<Record<string, string>> = {}
      ) =>
        Effect.gen(function* () {
          yield* destination.addCategories(name, product.key, id, categoryIds);
          yield* destination.assignReferences(
            name,
            product,
            id,
            relatedIds,
            referenceIds
          );
          for (const { images, sku, quantity } of product.variants) {
            yield* destination.assignGallery(
              name,
              product.key,
              id,
              sku,
              images.flatMap(({ url }) => {
                const fileId = fileIds.get(url);
                return fileId ? [fileId] : [];
              })
            );
            yield* destination.upsertInventory(
              name,
              product.key,
              id,
              sku,
              quantity
            );
          }
          yield* destination.addCollectionProduct(collection, id);
          yield* destination.translateProduct(name, product, id);
          yield* destination.publish(id);
        }),
    },
    files,
    inputs,
    loseNextResponse: () => {
      loseResponse = true;
    },
    members,
    metafieldWrites,
    omitOptionDigests: () => {
      missingOptionDigest = true;
    },
    product: () => current,
    rejectNextOptionTranslation: () => {
      rejectOptionTranslation = true;
    },
    removeOptions: () => {
      nativeOptions = [];
    },
    renameOptions: () => {
      nativeOptions = nativeOptions.map((option) => ({
        ...option,
        name: "Name edited in Shopify",
        optionValues: option.optionValues.map((value) => ({
          ...value,
          name: "Value edited in Shopify",
        })),
      }));
    },
    setImagesPending: (value: boolean) => {
      pendingImages = value;
    },
    setProduct: (value: ProductResource) => {
      current = value;
    },
    translationWrites,
    translations,
    writes,
  };
};

layer(testTracking)("Shopify catalog destination", (it) => {
  it.effect(
    "updates the tracked product and preserves existing variant IDs and merchant metafields",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        yield* fixture.destination.upsertProduct("b2c", bottle);
        const current = fixture.product();
        if (current === null) {
          return yield* Effect.die("Product was not persisted");
        }
        fixture.setProduct({
          ...current,
          metafields: fields([
            ...current.metafields.nodes,
            {
              key: "note",
              namespace: "merchant",
              type: "single_line_text_field",
              value: "Keep this",
            },
          ]),
        });
        const id = yield* fixture.destination.upsertProduct("b2c", bottle);
        expect(id).toBe(current.id);
        expect(fixture.inputs[1]?.variants[0]?.id).toBe(
          current.variants.nodes[0]?.id
        );
        expect(fixture.inputs[1]?.metafields).toContainEqual({
          key: "note",
          namespace: "merchant",
          type: "single_line_text_field",
          value: "Keep this",
        });
      })
  );
  it.effect("rejects an untracked Product after an uncertain create", () =>
    Effect.gen(function* () {
      const fixture = adminFixture();
      fixture.loseNextResponse();
      yield* fixture.destination.upsertProduct("b2c", bottle).pipe(Effect.flip);
      yield* fixture.destination.upsertProduct("b2c", bottle).pipe(Effect.flip);
      expect(
        fixture.writes.filter((operation) => operation === "productSet")
      ).toHaveLength(1);
    })
  );
  it.effect("does not overwrite unowned products", () =>
    Effect.gen(function* () {
      const fixture = adminFixture();
      yield* fixture.destination.upsertProduct("b2c", bottle);
      const current = fixture.product();
      if (current === null) {
        return yield* Effect.die("Product missing");
      }
      fixture.setProduct({ ...current, tags: [] });
      const outcome = yield* fixture.destination
        .upsertProduct("b2c", bottle)
        .pipe(Effect.result);
      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: {
          message: "An existing product is not owned by this seed catalog",
        },
      });
      expect(fixture.writes).toEqual(["productSet"]);
    })
  );
  it.effect(
    "replays stock and collection membership safely before publishing",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        const id = yield* fixture.destination.upsertProduct("b2c", bottle);
        yield* fixture.destination.completeProduct(
          "b2c",
          bottle,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        yield* fixture.destination.completeProduct(
          "b2c",
          bottle,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        expect(
          fixture.writes.filter(
            (operation) => operation === "inventoryActivate"
          )
        ).toHaveLength(1);
        expect(
          fixture.writes.filter(
            (operation) => operation === "collectionAddProducts"
          )
        ).toHaveLength(1);
        expect(fixture.writes.indexOf("inventoryActivate")).toBeLessThan(
          fixture.writes.indexOf("publishablePublish")
        );
      })
  );
  it.effect(
    "updates existing stock with compare-and-swap and a required Shopify idempotency key",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        const id = yield* fixture.destination.upsertProduct("b2c", bottle);
        yield* fixture.destination.completeProduct(
          "b2c",
          bottle,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        const changed = Schema.decodeUnknownSync(CatalogProduct)({
          ...bottle,
          variants: [{ ...bottle.variants[0], quantity: 5 }],
        });
        yield* fixture.destination.completeProduct(
          "b2c",
          changed,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        yield* fixture.destination.completeProduct(
          "b2c",
          changed,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        expect(
          fixture.writes.filter(
            (operation) => operation === "inventorySetQuantities"
          )
        ).toHaveLength(1);
      })
  );
  it.effect(
    "updates existing definitions by namespace, key and owner with public Storefront access",
    () =>
      Effect.gen(function* () {
        const updates: Schema.Json[] = [];
        const created: Schema.Json[] = [];
        const fetchApi: typeof fetch = async (_url, init) => {
          const { query, variables } = Schema.decodeUnknownSync(Request)(
            await new Response(init?.body).text()
          );
          if (query.includes("query CatalogLocales")) {
            return Response.json({
              data: {
                availableLocales: ["en", "fr"].map((isoCode) => ({ isoCode })),
                shopLocales: [
                  { locale: "en", primary: true, published: true },
                  { locale: "fr", primary: false, published: true },
                ],
              },
            });
          }
          if (query.includes("CatalogTarget")) {
            return Response.json({
              data: {
                location: { id: settings.locationId, isActive: true },
                publication: { id: settings.publicationId },
                shop: { currencyCode: "USD" },
                shopLocales: [
                  { locale: "en", primary: true, published: true },
                  { locale: "fr", primary: false, published: true },
                ],
              },
            });
          }
          if (query.includes("query StoreAttributionDefinition")) {
            return Response.json({
              data: { metafieldDefinition: storeAttributionDefinition },
            });
          }
          if (query.includes("metafieldDefinitions(")) {
            return Response.json({
              data: {
                metafieldDefinitions: {
                  nodes: (variables.namespace === "commerce"
                    ? attributeDefinitions
                    : []
                  )
                    .filter(
                      (definition) =>
                        variables.owner === "PRODUCT" ||
                        definition.key !== "productType"
                    )
                    .map((definition) => ({
                      access: {
                        storefront:
                          definition.key === "capacity"
                            ? "NONE"
                            : "PUBLIC_READ",
                      },
                      id: definition.key,
                      key: definition.key,
                      type: { name: definition.type },
                    })),
                },
              },
            });
          }
          if (query.includes("metafieldDefinitionCreate(")) {
            created.push(variables.definition ?? null);
            return Response.json({
              data: {
                metafieldDefinitionCreate: {
                  createdDefinition: {
                    id: `gid://shopify/MetafieldDefinition/${created.length + 1}`,
                  },
                  userErrors: [],
                },
              },
            });
          }
          if (query.includes("metafieldDefinitionUpdate(")) {
            updates.push(variables.definition ?? null);
            return Response.json({
              data: { metafieldDefinitionUpdate: { userErrors: [] } },
            });
          }
          throw new Error("Unexpected schema operation");
        };
        const ids = new Map<string, string>([
          ["store_key", storeAttributionDefinition.id],
        ]);
        for (const definition of catalogMetafieldDefinitions) {
          if (
            definition.namespace === "commerce" &&
            attributeDefinitions.some(({ key }) => key === definition.key) &&
            (definition.ownerType === "PRODUCT" ||
              definition.key !== "productType")
          ) {
            ids.set(
              `${definition.ownerType}/${definition.namespace}/${definition.key}`,
              definition.key
            );
          }
        }
        yield* ensureCatalogSetup(
          makeCatalogDestination({
            fetchApi,
            settings: Effect.succeed(settings),
          }),
          "b2c",
          ids
        );
        expect(created).toContainEqual({
          access: { storefront: "PUBLIC_READ" },
          key: "optionBindings",
          name: "Catalog option IDs",
          namespace: "commerce_shopify",
          ownerType: "PRODUCT",
          type: "json",
        });
        expect(updates).toEqual(
          ["PRODUCT", "PRODUCTVARIANT"].map((ownerType) => ({
            access: { storefront: "PUBLIC_READ" },
            key: "capacity",
            namespace: "commerce",
            ownerType,
          }))
        );
      })
  );
  it.effect(
    "rejects extensionless image sources before submitting product writes",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        const source = yield* Schema.decodeUnknownEffect(CatalogProduct)({
          ...bottle,
          variants: bottle.variants.map((variant) => ({
            ...variant,
            images: variant.images.map((image) => ({
              ...image,
              url: "https://example.com/image?format=png",
            })),
          })),
        });
        const error = yield* fixture.destination
          .upsertProduct("b2c", source)
          .pipe(Effect.flip);
        expect(error.message).toContain("explicit filename extension");
        expect(fixture.inputs).toEqual([]);
      })
  );
  it.effect(
    "reuses uploaded file IDs, registers translations and preserves category membership",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        const category = loadCatalog("b2c").categories.find(
          ({ key }) => key === bottle.categoryKeys[0]
        );
        if (category === undefined) {
          return yield* Effect.die("Missing category");
        }
        const categoryId = yield* fixture.destination.upsertCategory(
          "b2c",
          category
        );
        const id = yield* fixture.destination.upsertProduct("b2c", bottle);
        yield* fixture.destination.upsertProduct("b2c", bottle);
        yield* fixture.destination.completeProduct(
          "b2c",
          bottle,
          id,
          "gid://shopify/Collection/1",
          [],
          [categoryId]
        );
        const additionalCategory = loadCatalog("b2c").categories.find(
          ({ key }) => key !== category.key
        );
        if (additionalCategory === undefined) {
          return yield* Effect.die("Missing additional category");
        }
        const additionalCategoryId = yield* fixture.destination.upsertCategory(
          "b2c",
          additionalCategory
        );
        yield* fixture.destination.addCategories("b2c", bottle.key, id, [
          additionalCategoryId,
        ]);
        yield* fixture.destination.addCategories("b2c", bottle.key, id, [
          additionalCategoryId,
        ]);
        expect([...fixture.members]).toEqual([
          categoryId,
          "gid://shopify/Collection/1",
          additionalCategoryId,
        ]);
        expect(fixture.inputs[0]?.files.map(({ id }) => id)).toEqual(
          [...fixture.files.values()].map(({ id }) => id)
        );
        expect(
          fixture.inputs[1]?.files.every(({ id }) => id !== undefined)
        ).toBeTruthy();
        expect(fixture.files.size).toBe(
          new Set(
            bottle.variants.flatMap(({ images }) =>
              images.map(({ url }) => url)
            )
          ).size
        );
        expect(fixture.translations.flat()).toContainEqual({
          key: "title",
          locale: "fr",
          translatableContentDigest: "title-digest",
          value: bottle.translations["fr-FR"]?.title,
        });
      })
  );
  it.effect(
    "registers model option names and enum labels before publication and reuses their IDs on rerun",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        // Other content in this catalog selects French even when this product has no content translation.
        const source = { ...mobileLift, translations: {} };
        const id = yield* fixture.destination.upsertProduct("b2b", source);
        fixture.renameOptions();
        const complete = fixture.destination.completeProduct(
          "b2b",
          source,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        yield* complete;
        const writtenFields = yield* Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              key: Schema.String,
              namespace: Schema.String,
              ownerId: Schema.String,
              type: Schema.String,
              value: Schema.String,
            })
          )
        )(fixture.metafieldWrites.flat());
        const saved = writtenFields.find(({ key }) => key === "optionBindings");
        const savedBindings = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(OptionBindings)
        )(saved?.value);
        expect({ ...saved, value: savedBindings }).toEqual({
          key: "optionBindings",
          namespace: "commerce_shopify",
          ownerId: id,
          type: "json",
          value: {
            color: {
              id: "gid://shopify/ProductOption/1",
              values: {
                BLUE: "gid://shopify/ProductOptionValue/2",
                RED: "gid://shopify/ProductOptionValue/1",
              },
            },
          },
        });
        const expected = [
          ["gid://shopify/ProductOption/1", "Couleur"],
          ["gid://shopify/ProductOptionValue/1", "Rouge"],
          ["gid://shopify/ProductOptionValue/2", "Bleu"],
        ].map(([id, value]) => ({
          id,
          translations: [
            {
              key: "name",
              locale: "fr",
              translatableContentDigest: `${id}:name`,
              value,
            },
          ],
        }));
        expect(fixture.translationWrites).toEqual(expected);
        expect(fixture.writes.lastIndexOf("translationsRegister")).toBeLessThan(
          fixture.writes.indexOf("publishablePublish")
        );
        yield* complete;
        expect(fixture.translationWrites).toEqual([...expected, ...expected]);
        expect(fixture.inputs[0]?.variants[0]?.metafields).toContainEqual({
          key: "color",
          namespace: "commerce",
          type: "single_line_text_field",
          value: "RED",
        });
      })
  );
  for (const failure of [
    "missing option",
    "missing digest",
    "rejected translation",
  ] as const) {
    it.effect(`keeps publication pending after a ${failure}`, () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        const id = yield* fixture.destination.upsertProduct("b2b", mobileLift);
        if (failure === "missing option") {
          fixture.removeOptions();
        } else if (failure === "missing digest") {
          fixture.omitOptionDigests();
        } else {
          fixture.rejectNextOptionTranslation();
        }
        const outcome = yield* fixture.destination
          .completeProduct(
            "b2b",
            mobileLift,
            id,
            "gid://shopify/Collection/1",
            [],
            []
          )
          .pipe(Effect.result);
        expect(outcome._tag).toBe("Failure");
        expect(fixture.writes).not.toContain("publishablePublish");
        if (failure === "rejected translation") {
          yield* fixture.destination.completeProduct(
            "b2b",
            mobileLift,
            id,
            "gid://shopify/Collection/1",
            [],
            []
          );
          expect(fixture.writes).toContain("publishablePublish");
        }
      })
    );
  }
  it.effect("imports the B2C model's French option and color labels", () =>
    Effect.gen(function* () {
      const jacket = loadCatalog("b2c").products.find(
        ({ key }) => key === "outdoor-trail-jacket"
      );
      if (jacket === undefined) {
        return yield* Effect.die("Missing B2C fixture");
      }
      const fixture = adminFixture();
      const productId = yield* fixture.destination.upsertProduct("b2c", jacket);
      yield* fixture.destination.completeProduct(
        "b2c",
        jacket,
        productId,
        "gid://shopify/Collection/1",
        [],
        []
      );
      expect(
        fixture.translationWrites.filter(({ id }) =>
          id.includes("/ProductOption")
        )
      ).toEqual(
        [
          ["gid://shopify/ProductOption/1", "Taille"],
          ["gid://shopify/ProductOption/2", "Couleur"],
          ["gid://shopify/ProductOptionValue/101", "Rouge"],
          ["gid://shopify/ProductOptionValue/102", "Bleu"],
        ].map(([resourceId, value]) => ({
          id: resourceId,
          translations: [
            {
              key: "name",
              locale: "fr",
              translatableContentDigest: `${resourceId}:name`,
              value,
            },
          ],
        }))
      );
    })
  );
  it.effect(
    "keeps publication pending while Shopify processes image files",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture();
        fixture.setImagesPending(true);
        const fiber = yield* fixture.destination
          .upsertProduct("b2c", bottle)
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("12 seconds");
        const result = yield* Effect.result(Fiber.join(fiber));
        expect(result._tag).toBe("Failure");
        expect(fixture.writes).not.toContain("publishablePublish");
        fixture.setImagesPending(false);
        const id = yield* fixture.destination.upsertProduct("b2c", bottle);
        yield* fixture.destination.completeProduct(
          "b2c",
          bottle,
          id,
          "gid://shopify/Collection/1",
          [],
          []
        );
        expect(fixture.writes).toContain("publishablePublish");
      })
  );
  it.effect(
    "enables and publishes missing catalog languages before creating definitions",
    () =>
      Effect.gen(function* () {
        const fixture = adminFixture([
          { locale: "en", primary: true, published: true },
        ]);
        yield* fixture.destination.ensureDefinitions("b2c");
        expect(fixture.writes.slice(0, 2)).toEqual([
          "shopLocaleEnable",
          "shopLocaleUpdate",
        ]);
        const completed = [...fixture.writes];
        yield* fixture.destination.ensureDefinitions("b2c");
        expect(
          fixture.writes.filter((operation) =>
            operation.startsWith("shopLocale")
          )
        ).toEqual(
          completed.filter((operation) => operation.startsWith("shopLocale"))
        );
      })
  );
  it.effect(
    "does not leak transport errors or credentials into migration errors",
    () =>
      Effect.gen(function* () {
        const destination = makeCatalogDestination({
          fetchApi: vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error("admin-secret")),
          settings: Effect.succeed(settings),
        });
        const outcome = yield* destination
          .upsertProduct("b2c", bottle, new Map())
          .pipe(Effect.result);
        expect(outcome._tag).toBe("Failure");
        expect(JSON.stringify(outcome)).not.toContain("admin-secret");
      })
  );
});
