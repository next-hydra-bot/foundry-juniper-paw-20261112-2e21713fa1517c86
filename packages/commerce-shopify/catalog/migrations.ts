import { documentRows } from "@repo/cli-core/json-migrations";
import type { DocumentRow } from "@repo/cli-core/json-migrations";
import {
  CatalogCategory,
  CatalogImage,
  CatalogProductContent,
  CatalogProductReferences,
  catalogReferenceKeys,
  catalogProductReferences,
  catalogProductContent,
} from "@repo/commerce-core/catalog";
import type { Catalog, CatalogName } from "@repo/commerce-core/catalog";
import { catalogByName } from "@repo/commerce-core/catalog/files";
import type { CatalogReaders } from "@repo/commerce-core/catalog/files";
import { productTypeDefinition } from "@repo/commerce-core/catalog/product-model";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  MigrationDefinitionRegistry,
  MigrationReferenceLookup,
  SourceIdentity,
  Tracking,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationReferenceForDefinition,
  MigrationReferenceLookupTarget,
  MigrationStore,
  MigrationStoreError,
} from "migrate-sdk";

import type { CatalogDestination } from "./destination";
import {
  CatalogMetafieldDefinition,
  catalogMetafieldDefinitions,
} from "./destination";
import { shopifyCatalogReaders, catalogTranslationLocales } from "./mapping";
import { productImages } from "./media";
import { ShopifyProductTranslation } from "./options";

const identity = SourceIdentity.make({
  id: "catalog-key@v1",
  schema: SourceIdentity.key("key", Schema.NonEmptyString),
});
const IdTracking = Tracking.record({
  id: "shopify-resource@v1",
  schema: Schema.Struct({ id: Schema.String }),
});
export const trackedShopifyRecord = <
  Definition extends AnySelfContainedMigrationDefinition,
>(
  definition: Definition,
  key: MigrationReferenceLookupTarget<Definition>["sourceIdentityKey"]
): Effect.Effect<
  MigrationReferenceForDefinition<Definition>["trackingRecord"],
  DestinationError,
  MigrationReferenceLookup
> =>
  Effect.gen(function* () {
    const references = yield* MigrationReferenceLookup;
    const reference = yield* references
      .lookup({ definition, sourceIdentityKey: key })
      .pipe(
        Effect.mapError(
          (cause) =>
            new DestinationError({
              cause,
              message: `${definition.id}: cannot resolve tracking record for ${key}`,
            })
        )
      );
    if (reference?.status !== "migrated") {
      return yield* new DestinationError({
        message: `${definition.id}: no successful record for ${key}`,
      });
    }
    return reference.trackingRecord;
  });

const CategoryMembership = Schema.Struct({
  productKey: Schema.NonEmptyString,
  categoryKeys: Schema.Array(Schema.NonEmptyString),
});
const { translations: _translations, ...shopifyContentFields } =
  CatalogProductContent.fields;
const ShopifyProductContent = Schema.Struct(shopifyContentFields);
const PublicationProduct = Schema.Struct({
  key: Schema.NonEmptyString,
  skus: Schema.Array(Schema.NonEmptyString),
});
const Gallery = Schema.Struct({
  productKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  images: Schema.Array(CatalogImage),
});
const FileItem = Schema.Struct({
  productKey: Schema.String,
  image: CatalogImage,
});
const fileKey = (productKey: string, image: CatalogImage) =>
  JSON.stringify([productKey, image.url]);
const InventoryItem = Schema.Struct({
  productKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  quantity: Schema.Int,
});

const localeItems = (catalog: Catalog) =>
  catalogTranslationLocales(catalog).map((key) => ({ item: key, key }));

export const makeCatalogRegistry = (options: {
  readonly store: Layer.Layer<MigrationStore, MigrationStoreError>;
  readonly destination: CatalogDestination;
  readonly catalogs?: Readonly<Record<string, Catalog>>;
  readonly readers?: CatalogReaders;
  readonly publicationId?: string | undefined;
  readonly locationId?: string | undefined;
}) => {
  const { destination, store } = options;
  const readers =
    options.readers ??
    (options.catalogs
      ? Object.fromEntries(
          Object.entries(options.catalogs).map(([name, catalog]) => [
            name,
            () => catalog,
          ])
        )
      : shopifyCatalogReaders());
  const localeRows = Effect.try({
    catch: (cause) =>
      new DestinationError({
        cause,
        message: "Unable to read catalog locales",
      }),
    try: () => {
      const rows = new Map<string, DocumentRow<string>>();
      for (const name of Object.keys(readers)) {
        const catalog = catalogByName(readers, name)();
        for (const { key } of localeItems(catalog)) {
          if (!rows.has(key)) {
            rows.set(key, { key, item: key, inputs: catalog.defaultLocale });
          }
        }
      }
      return [...rows.values()];
    },
  });
  const locales = MigrationDefinition.make({
    group: "project-setup",
    id: "shopify-locales",
    execution: { process: { concurrency: 1 } },
    source: documentRows(Schema.String, localeRows, identity),
    store,
    tracking: IdTracking,
    process: Effect.fn("ShopifyCatalog.locale")(function* (
      entry,
      { previousState }
    ) {
      const locale = entry.item.item.payload;
      const name = yield* Effect.try({
        catch: (cause) =>
          new DestinationError({
            cause,
            message: "Unable to resolve catalog locale",
          }),
        try: () =>
          Object.keys(readers).find((candidate) =>
            catalogTranslationLocales(
              catalogByName(readers, candidate)()
            ).includes(locale)
          ),
      });
      if (name === undefined) {
        return yield* new DestinationError({
          message: `No catalog declares locale ${locale}`,
        });
      }
      const journal = previousState?.journal;
      const attempts = journal
        ? [...(journal.processAttempts ?? []), journal.process]
        : [];
      const enableAcknowledged = attempts.some(({ entries }) =>
        entries.some(
          (entry) =>
            entry.kind === "change" &&
            entry.descriptorId === "shopify-admin-mutation@v1" &&
            Schema.is(
              Schema.Struct({ operation: Schema.Literal("shopLocaleEnable") })
            )(entry.value)
        )
      );
      yield* destination.ensureLocale(
        name,
        locale,
        previousState?.trackingRecord !== undefined || enableAcknowledged
      );
      yield* Tracking.setRecord({ id: locale });
    }),
  });
  const attributionKey = "ORDER/commerce/store_key";
  const attribution = MigrationDefinition.make({
    group: "project-setup",
    id: "shopify-order-attribution",
    source: documentRows(
      Schema.String,
      Effect.succeed([{ item: attributionKey, key: attributionKey }]),
      identity
    ),
    store,
    tracking: IdTracking,
    process: Effect.fn("ShopifyCatalog.storeAttribution")(function* (
      _entry,
      { previousState }
    ) {
      const id = yield* destination.ensureStoreAttribution(
        previousState?.trackingRecord?.id
      );
      yield* Tracking.setRecord({ id });
    }),
  });
  const definitionItems = catalogMetafieldDefinitions.map((item) => ({
    item,
    key: `${item.ownerType}/${item.namespace}/${item.key}`,
  }));
  const definitions = MigrationDefinition.make({
    execution: { process: { concurrency: 1 } },
    group: "project-setup",
    id: "shopify-metafield-definitions",
    source: documentRows(
      CatalogMetafieldDefinition,
      Effect.succeed(definitionItems),
      identity
    ),
    store,
    tracking: IdTracking,
    process: Effect.fn("ShopifyCatalog.metafieldDefinition")(function* (
      entry,
      { previousState }
    ) {
      const id = yield* destination.ensureDefinition(
        entry.item.item.payload,
        previousState?.trackingRecord?.id
      );
      yield* Tracking.setRecord({ id });
    }),
  });
  const makeCatalog = (name: CatalogName) => {
    const read = Effect.try({
      try: catalogByName(readers, name),
      catch: (cause) =>
        new DestinationError({
          cause,
          message: `Unable to read catalog ${name}`,
        }),
    });
    const source = <A>(
      schema: Schema.Codec<A, unknown>,
      select: (catalog: Catalog) => readonly DocumentRow<A>[]
    ) =>
      documentRows(
        Schema.toType(schema),
        read.pipe(Effect.map(select)),
        identity
      );
    const preflight = MigrationDefinition.make({
      group: name,
      id: `${name}-preflight`,
      process: () =>
        destination
          .preflight(name)
          .pipe(Effect.flatMap((id) => Tracking.setRecord({ id }))),
      source: source(Schema.String, (catalog) => [
        {
          key: name,
          item: name,
          inputs: [
            options.publicationId ?? null,
            catalog.defaultLocale,
            catalogTranslationLocales(catalog),
            catalog.products.map(({ key, options, variants }) => ({
              key,
              optionCount: options.length,
              variants: variants.map(({ price, attributes }) => ({
                currencyCode: price.regular.currencyCode,
                attributeCount: Object.keys(attributes).length,
              })),
            })),
          ],
        },
      ]),
      store,
      tracking: IdTracking,
    });
    const schemaReady = Effect.fn("ShopifyCatalog.schemaReady")(function* () {
      yield* trackedShopifyRecord(preflight, name);
      yield* trackedShopifyRecord(attribution, attributionKey);
      yield* Effect.forEach(
        definitionItems,
        ({ key }) => trackedShopifyRecord(definitions, key),
        { discard: true }
      );
    });
    const localesReady = read.pipe(
      Effect.flatMap((catalog) =>
        Effect.forEach(
          localeItems(catalog),
          ({ key }) => trackedShopifyRecord(locales, key),
          { discard: true }
        )
      )
    );
    const collection = MigrationDefinition.make({
      dependencies: {
        required: [preflight.id, definitions.id, attribution.id],
      },
      group: name,
      id: `${name}-collection`,
      process: Effect.fn("ShopifyCatalog.collection")(function* (
        _entry,
        { previousState }
      ) {
        yield* schemaReady();
        const id = yield* destination.ensureCollection(
          name,
          previousState?.trackingRecord?.id
        );
        yield* Tracking.setRecord({ id });
      }),
      source: source(Schema.String, () => [{ item: name, key: name }]),
      store,
      tracking: IdTracking,
    });
    const categories = MigrationDefinition.make({
      dependencies: {
        required: [preflight.id, definitions.id, attribution.id],
      },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-categories`,
      process: Effect.fn("ShopifyCatalog.category")(function* (
        entry,
        { previousState }
      ) {
        yield* schemaReady();
        const id = yield* destination.upsertCategory(
          name,
          entry.item.item.payload,
          previousState?.trackingRecord?.id
        );
        yield* Tracking.setRecord({ id });
      }),
      source: source(CatalogCategory, ({ categories, defaultLocale }) =>
        categories.map((item) => ({
          item,
          key: item.key,
          inputs: defaultLocale,
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const categorySource = source(
      CatalogCategory,
      ({ categories, defaultLocale }) =>
        categories.map((item) => ({
          item,
          key: item.key,
          inputs: defaultLocale,
        }))
    );
    const categoryTranslations = MigrationDefinition.make({
      dependencies: { required: [categories.id, locales.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-category-translations`,
      process: Effect.fn("ShopifyCatalog.categoryTranslations")(
        function* (entry) {
          yield* localesReady;
          const { id } = yield* trackedShopifyRecord(
            categories,
            entry.item.item.payload.key
          );
          yield* destination.translateCategory(id, entry.item.item.payload);
          yield* Tracking.setRecord({ id });
        }
      ),
      source: categorySource,
      store,
      tracking: IdTracking,
    });
    const categoryPublication = MigrationDefinition.make({
      dependencies: { required: [categoryTranslations.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-category-publication`,
      process: Effect.fn("ShopifyCatalog.categoryPublication")(
        function* (entry) {
          const { id } = yield* trackedShopifyRecord(
            categoryTranslations,
            entry.item.item.payload.key
          );
          yield* destination.publish(id);
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(CatalogCategory, ({ categories }) =>
        categories.map((item) => ({
          key: item.key,
          item,
          inputs: options.publicationId ?? null,
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const collectionPublication = MigrationDefinition.make({
      dependencies: { required: [collection.id] },
      group: name,
      id: `${name}-collection-publication`,
      process: Effect.fn("ShopifyCatalog.collectionPublication")(
        function* (entry) {
          const { id } = yield* trackedShopifyRecord(
            collection,
            entry.item.item.payload
          );
          yield* destination.publish(id);
          yield* Tracking.setRecord({ id });
        }
      ),
      source: source(Schema.String, () => [
        { item: name, key: name, inputs: options.publicationId ?? null },
      ]),
      store,
      tracking: IdTracking,
    });
    const productKeys = source(Schema.String, ({ products }) =>
      products.map(({ key }) => ({ item: key, key }))
    );
    const productContent = source(ShopifyProductContent, ({ products }) =>
      products.map((product) => {
        const { translations: _translations, ...item } =
          catalogProductContent(product);
        return {
          key: product.key,
          item,
          inputs: JSON.stringify(productTypeDefinition(product.productType)),
        };
      })
    );
    const files = MigrationDefinition.make({
      dependencies: { required: [preflight.id] },
      group: name,
      id: `${name}-files`,
      source: source(FileItem, ({ products }) =>
        products.flatMap((product) =>
          productImages(product).map((image) => ({
            item: { productKey: product.key, image },
            key: fileKey(product.key, image),
          }))
        )
      ),
      store,
      tracking: IdTracking,
      process: Effect.fn("ShopifyCatalog.file")(function* (
        entry,
        { previousState }
      ) {
        const { productKey, image } = entry.item.item.payload;
        const id =
          previousState?.trackingRecord?.id ??
          (yield* destination.createImage(productKey, image));
        yield* Tracking.setRecord({ id });
      }),
    });
    const importedProducts = MigrationDefinition.make({
      dependencies: {
        required: [preflight.id, definitions.id, attribution.id, files.id],
      },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-products`,
      process: Effect.fn("ShopifyCatalog.importProduct")(function* (
        {
          item: {
            item: { payload: item },
          },
        },
        { previousState }
      ) {
        yield* schemaReady();
        const images = new Map<string, string>();
        for (const image of productImages(item)) {
          const { id } = yield* trackedShopifyRecord(
            files,
            fileKey(item.key, image)
          );
          images.set(image.url, id);
        }
        const id = yield* destination.upsertProduct(
          name,
          item,
          images,
          previousState?.trackingRecord?.id
        );
        yield* Tracking.setRecord({ id });
      }),
      source: productContent,
      store,
      tracking: IdTracking,
    });
    const categoryProducts = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id, categoryPublication.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-category-products`,
      process: Effect.fn("ShopifyCatalog.categoryProducts")(function* (entry) {
        const { productKey, categoryKeys } = entry.item.item.payload;
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          productKey
        );
        const categoryIds = yield* Effect.forEach(
          categoryKeys,
          (key) =>
            trackedShopifyRecord(categoryPublication, key).pipe(
              Effect.map(({ id }) => id)
            ),
          { concurrency: 1 }
        );
        yield* destination.addCategories(name, productKey, id, categoryIds);
        yield* Tracking.setRecord({ id });
      }),
      source: source(CategoryMembership, ({ products }) =>
        products.map(({ key, categoryKeys }) => ({
          key,
          item: { productKey: key, categoryKeys },
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const references = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-product-references`,
      process: Effect.fn("ShopifyCatalog.productReferences")(function* ({
        item: {
          item: { payload: product },
        },
      }) {
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          product.key
        );
        const ids = yield* Effect.forEach(
          product.relatedProductKeys,
          (key) =>
            trackedShopifyRecord(importedProducts, key).pipe(
              Effect.map(({ id }) => id)
            ),
          { concurrency: 1 }
        );
        const entries = yield* Effect.forEach(
          catalogReferenceKeys(product),
          (key) =>
            trackedShopifyRecord(importedProducts, key).pipe(
              Effect.map(({ id: referenceId }) => [key, referenceId] as const)
            ),
          { concurrency: 1 }
        );
        yield* destination.assignReferences(
          name,
          product,
          id,
          ids,
          Object.fromEntries(entries)
        );
        yield* Tracking.setRecord({ id });
      }),
      source: source(CatalogProductReferences, ({ products }) =>
        products.map((product) => ({
          key: product.key,
          item: catalogProductReferences(product),
          inputs: JSON.stringify(productTypeDefinition(product.productType)),
        }))
      ),
      store,
      tracking: IdTracking,
    });
    const galleries = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id, files.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-variant-galleries`,
      process: Effect.fn("ShopifyCatalog.gallery")(function* (entry) {
        const { images, productKey, sku } = entry.item.item.payload;
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          productKey
        );
        const imageIds: string[] = [];
        for (const image of images) {
          const { id } = yield* trackedShopifyRecord(
            files,
            fileKey(productKey, image)
          );
          imageIds.push(id);
        }
        const variantId = yield* destination.assignGallery(
          name,
          productKey,
          id,
          sku,
          imageIds
        );
        yield* Tracking.setRecord({ id: variantId });
      }),
      source: source(Gallery, ({ products }) =>
        products.flatMap(({ key, variants }) =>
          variants.map(({ sku, images }) => ({
            key: sku,
            item: { productKey: key, sku, images },
          }))
        )
      ),
      store,
      tracking: IdTracking,
    });
    const translations = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id, locales.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-product-translations`,
      process: Effect.fn("ShopifyCatalog.productTranslations")(function* ({
        item: {
          item: { payload: product },
        },
      }) {
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          product.key
        );
        yield* localesReady;
        yield* destination.translateProduct(name, product, id);
        yield* Tracking.setRecord({ id });
      }),
      source: source(ShopifyProductTranslation, (catalog) =>
        catalog.products.map(
          ({ key, productType, options, translations, variants }) => ({
            key,
            item: {
              key,
              productType,
              options,
              translations,
              variants: variants.map(({ sku, optionValues }) => ({
                sku,
                optionValues,
              })),
            },
            inputs: [
              catalogTranslationLocales(catalog),
              JSON.stringify(productTypeDefinition(productType)),
            ],
          })
        )
      ),
      store,
      tracking: IdTracking,
    });
    const inventory = MigrationDefinition.make({
      dependencies: { required: [importedProducts.id] },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-inventory`,
      process: Effect.fn("ShopifyCatalog.inventory")(function* (entry) {
        const { productKey, quantity, sku } = entry.item.item.payload;
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          productKey
        );
        const inventoryId = yield* destination.upsertInventory(
          name,
          productKey,
          id,
          sku,
          quantity
        );
        yield* Tracking.setRecord({ id: inventoryId });
      }),
      source: source(InventoryItem, ({ products }) =>
        products.flatMap(({ key, variants }) =>
          variants.map(({ sku, quantity }) => ({
            key: sku,
            item: { productKey: key, quantity, sku },
            inputs: options.locationId ?? null,
          }))
        )
      ),
      store,
      tracking: IdTracking,
    });
    const collectionProducts = MigrationDefinition.make({
      dependencies: {
        required: [collectionPublication.id, importedProducts.id],
      },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-collection-products`,
      process: Effect.fn("ShopifyCatalog.collectionProducts")(function* ({
        item: {
          item: { payload: key },
        },
      }) {
        const { id } = yield* trackedShopifyRecord(importedProducts, key);
        const { id: collectionId } = yield* trackedShopifyRecord(
          collectionPublication,
          name
        );
        yield* destination.addCollectionProduct(collectionId, id);
        yield* Tracking.setRecord({ id });
      }),
      source: productKeys,
      store,
      tracking: IdTracking,
    });
    const publishedProducts = MigrationDefinition.make({
      dependencies: {
        required: [
          importedProducts.id,
          categoryProducts.id,
          references.id,
          galleries.id,
          translations.id,
          collectionProducts.id,
        ],
      },
      execution: { process: { concurrency: 1 } },
      group: name,
      id: `${name}-publication`,
      process: Effect.fn("ShopifyCatalog.productPublication")(function* ({
        item: {
          item: { payload: product },
        },
      }) {
        for (const definition of [
          categoryProducts,
          references,
          translations,
          collectionProducts,
        ]) {
          yield* trackedShopifyRecord(definition, product.key);
        }
        yield* Effect.forEach(
          product.skus,
          (sku) => trackedShopifyRecord(galleries, sku),
          { discard: true }
        );
        const { id } = yield* trackedShopifyRecord(
          importedProducts,
          product.key
        );
        yield* destination.publish(id);
        yield* Tracking.setRecord({ id });
      }),
      source: source(PublicationProduct, ({ products }) =>
        products.map(({ key, variants }) => ({
          key,
          item: { key, skus: variants.map(({ sku }) => sku) },
          inputs: options.publicationId ?? null,
        }))
      ),
      store,
      tracking: IdTracking,
    });

    return [
      preflight,
      collection,
      categories,
      categoryTranslations,
      categoryPublication,
      collectionPublication,
      files,
      importedProducts,
      categoryProducts,
      references,
      galleries,
      translations,
      inventory,
      collectionProducts,
      publishedProducts,
    ] as const;
  };
  return MigrationDefinitionRegistry.make({
    definitions:
      Object.keys(readers).length === 0
        ? []
        : [
            locales,
            attribution,
            definitions,
            ...Object.keys(readers).flatMap(makeCatalog),
          ],
  });
};
