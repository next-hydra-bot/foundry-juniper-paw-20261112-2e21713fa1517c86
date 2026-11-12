import { randomUUID } from "node:crypto";

import type {
  Catalog,
  CatalogCategory,
  CatalogImage,
  CatalogName,
  CatalogProductContent,
  CatalogProductReferences,
} from "@repo/commerce-core/catalog";
import { catalogByName } from "@repo/commerce-core/catalog/files";
import type { CatalogReaders } from "@repo/commerce-core/catalog/files";
import { productTypeDefinition } from "@repo/commerce-core/catalog/product-model";
import { ConfigProvider, Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { prepareAdminSettings } from "../admin/provisioning";
import { attributeDefinitions } from "../product/attributes";
import { modelMetafields, attributeField } from "../product/model";
import { OptionBindings } from "../product/options";
import { provisionStoreAttribution } from "../provisioning/store-attribution";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This transport factory is a plain Admin client, not a contextual Effect service.
import { journalCatalogAdmin, makeCatalogAdmin } from "./admin";
import { provisionCatalogLocales } from "./locales";
import {
  shopifyCatalogReaders,
  htmlText,
  catalogTranslationLocales,
  productOptionTranslations,
  shopifyLocale,
  productOptions,
  toMetafields,
  variantOptions,
  shopifyMoney,
} from "./mapping";
import { imageFilename, productImages } from "./media";
import { OptionResources, bindProductOptions } from "./options";
import type { ShopifyProductTranslation } from "./options";

export const CatalogSettings = Schema.Struct({
  domain: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u)
  ),
  locationId: Schema.optional(
    Schema.String.check(Schema.isPattern(/^gid:\/\/shopify\/Location\/\d+$/u))
  ),
  publicationId: Schema.String.check(
    Schema.isPattern(/^gid:\/\/shopify\/Publication\/\d+$/u)
  ),
  token: Schema.NonEmptyString,
});
export type CatalogSettings = typeof CatalogSettings.Type;
export const settingsFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>>
) =>
  Effect.gen(function* () {
    const settings = yield* prepareAdminSettings(
      ConfigProvider.fromUnknown(environment)
    );
    return settings.pipe(
      Effect.flatMap((credentials) =>
        Schema.decodeUnknownEffect(CatalogSettings)({
          ...credentials,
          locationId: environment.SHOPIFY_CATALOG_LOCATION_ID,
          publicationId: environment.SHOPIFY_CATALOG_PUBLICATION_ID,
        }).pipe(
          Effect.mapError(
            () =>
              new DestinationError({
                message:
                  "Configure the catalog myshopify.com domain and publication ID in catalog/.env",
              })
          )
        )
      )
    );
  });

const Metafield = Schema.Struct({
  key: Schema.String,
  namespace: Schema.String,
  type: Schema.String,
  value: Schema.String,
});
const MetafieldConnection = Schema.Struct({
  nodes: Schema.Array(Metafield),
  pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
});
const VariantResource = Schema.Struct({
  id: Schema.String,
  inventoryItem: Schema.optionalKey(
    Schema.Struct({
      id: Schema.String,
      inventoryLevel: Schema.NullOr(
        Schema.Struct({
          quantities: Schema.Array(
            Schema.Struct({ name: Schema.String, quantity: Schema.Int })
          ),
        })
      ),
    })
  ),
  metafields: MetafieldConnection,
  sku: Schema.NullOr(Schema.String),
});
const ProductResource = Schema.Struct({
  id: Schema.String,
  metafields: MetafieldConnection,
  tags: Schema.Array(Schema.String),
  variants: Schema.Struct({
    nodes: Schema.Array(VariantResource),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  }),
});
export type ProductResource = typeof ProductResource.Type;
// Bound nested connections to keep the Admin preservation read below the single-query cost limit.
const resourceFields = (inventoryFields: string) =>
  `id tags metafields(first:20) { nodes { namespace key type value } pageInfo { hasNextPage } } variants(first:20) { nodes { id sku metafields(first:20) { nodes { namespace key type value } pageInfo { hasNextPage } } ${inventoryFields} } pageInfo { hasNextPage } }`;
const fail = (message: string) => new DestinationError({ message });
const managedTag = (name: CatalogName) => `catalog-seed:${name}`;
const collectionHandle = (name: CatalogName) => {
  if (name === "b2b") {
    return "equipment-catalog";
  }
  if (name === "b2c") {
    return "outdoor-catalog";
  }
  return `catalog-${name}`;
};
const collectionTitle = (name: CatalogName) => {
  if (name === "b2b") {
    return "Equipment";
  }
  if (name === "b2c") {
    return "Outdoor";
  }
  return name;
};

const mergeMetafields = (
  existing: readonly (typeof Metafield.Type)[],
  changes: readonly (typeof Metafield.Type)[]
) => [
  ...new Map(
    [...existing, ...changes].map((field) => [
      `${field.namespace}/${field.key}`,
      field,
    ])
  ).values(),
];

const definitionsFor = (
  ownerType: string
): readonly {
  readonly key: string;
  readonly name: string;
  readonly type: string;
}[] => {
  if (ownerType === "COLLECTION") {
    return [
      {
        key: "seedCatalog",
        name: "Seed catalog",
        type: "single_line_text_field",
      },
      {
        key: "seedCategory",
        name: "Seed category",
        type: "single_line_text_field",
      },
    ];
  }
  if (ownerType === "PRODUCTVARIANT") {
    return [
      ...attributeDefinitions.filter(({ key }) => key !== "productType"),
      {
        key: "variantImages",
        name: "Variant image gallery",
        type: "list.file_reference",
      },
    ];
  }
  return attributeDefinitions;
};

export const CatalogMetafieldDefinition = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  namespace: Schema.String,
  ownerType: Schema.String,
  type: Schema.String,
});
type CatalogMetafieldDefinition = typeof CatalogMetafieldDefinition.Type;
export const catalogMetafieldDefinitions: readonly CatalogMetafieldDefinition[] =
  [
    ...["PRODUCT", "PRODUCTVARIANT", "COLLECTION"].flatMap((ownerType) =>
      definitionsFor(ownerType).map((entry) => ({
        ...entry,
        namespace: "commerce",
        ownerType,
      }))
    ),
    {
      key: "optionBindings",
      name: "Catalog option IDs",
      namespace: "commerce_shopify",
      ownerType: "PRODUCT",
      type: "json",
    },
  ];

export const makeCatalogDestination = (options: {
  readonly settings: Effect.Effect<CatalogSettings, DestinationError>;
  readonly fetchApi?: typeof fetch;
  readonly catalogs?: Readonly<Record<string, Catalog>>;
  readonly readers?: CatalogReaders;
}) => {
  const readCatalog = options.catalogs
    ? (name: CatalogName) => catalogByName(options.catalogs ?? {}, name)
    : (name: CatalogName) =>
        catalogByName(options.readers ?? shopifyCatalogReaders(), name)();
  const fetchApi = options.fetchApi ?? globalThis.fetch;
  const admin = journalCatalogAdmin(
    makeCatalogAdmin(options.settings, fetchApi)
  );
  const { request, mutation } = admin;
  const readProduct = Effect.fn("ShopifyCatalog.readProduct")(function* (
    identifier: { readonly handle: string } | { readonly id: string },
    locationId?: string
  ) {
    const data = yield* locationId === undefined
      ? request(
          "readProduct",
          `query SeedProduct($identifier:ProductIdentifierInput!) { product:productByIdentifier(identifier:$identifier) { ${resourceFields("")} } }`,
          { identifier }
        )
      : request(
          "readInventoryProduct",
          `query SeedInventoryProduct($identifier:ProductIdentifierInput!,$locationId:ID!) { location(id:$locationId) { isActive } product:productByIdentifier(identifier:$identifier) { ${resourceFields('inventoryItem { id inventoryLevel(locationId:$locationId) { quantities(names:["available"]) { name quantity } } }')} } }`,
          { identifier, locationId }
        );
    if (
      locationId !== undefined &&
      !Schema.is(Schema.Struct({ isActive: Schema.Literal(true) }))(
        data.location
      )
    ) {
      return yield* fail(
        "Catalog inventory requires an active inventory location"
      );
    }
    const product = yield* Schema.decodeUnknownEffect(
      Schema.NullOr(ProductResource)
    )(data.product).pipe(
      Effect.mapError(() => fail("Invalid catalog product response"))
    );
    if (
      product !== null &&
      (product.variants.pageInfo.hasNextPage ||
        product.metafields.pageInfo.hasNextPage ||
        product.variants.nodes.some(
          (variant) => variant.metafields.pageInfo.hasNextPage
        ))
    ) {
      return yield* fail(
        `Catalog product exceeds the importer's supported resource size: ${"id" in identifier ? identifier.id : identifier.handle}`
      );
    }
    return product;
  });
  const assertOwned = (product: ProductResource, name: CatalogName) =>
    product.tags.includes(managedTag(name))
      ? Effect.void
      : fail("An existing product is not owned by this seed catalog");
  const preflight = Effect.fn("ShopifyCatalog.preflight")(function* (
    name: CatalogName
  ) {
    const settings = yield* options.settings;
    const data = yield* request(
      "preflight",
      `query CatalogTarget($publication:ID!) { shop { currencyCode } publication(id:$publication) { id } }`,
      { publication: settings.publicationId }
    );
    const target = yield* Schema.decodeUnknownEffect(
      Schema.Struct({
        publication: Schema.Struct({ id: Schema.String }),
        shop: Schema.Struct({ currencyCode: Schema.String }),
      })
    )(data).pipe(
      Effect.mapError(() =>
        fail("Catalog imports require an accessible publication")
      )
    );
    if (
      readCatalog(name).products.some(({ variants }) =>
        variants.some(
          ({ price }) => price.regular.currencyCode !== target.shop.currencyCode
        )
      )
    ) {
      return yield* fail("Catalog base prices must match the shop currency");
    }
    for (const product of readCatalog(name).products) {
      if (product.options.length > 3) {
        return yield* fail(
          `Shopify supports at most three variant options: ${product.key}`
        );
      }
      if (
        product.variants.some(
          (variant) => Object.keys(variant.attributes).length + 1 > 20
        )
      ) {
        return yield* fail(
          `The starter importer reads at most 20 variant metafields including its gallery: ${product.key}`
        );
      }
    }
    yield* provisionCatalogLocales(admin, readCatalog(name), {
      dryRun: true,
    });
    return target.publication.id;
  });
  const ensureLocale = (
    name: CatalogName,
    sourceLocale: string,
    canPublishExisting: boolean
  ) =>
    provisionCatalogLocales(admin, readCatalog(name), {
      canPublishExisting,
      sourceLocale,
    });
  const ensureDefinition = Effect.fn("ShopifyCatalog.ensureDefinition")(
    function* (definition: CatalogMetafieldDefinition, trackedId?: string) {
      const { namespace, ownerType, key } = definition;
      const data = yield* request(
        "definitions",
        `query SeedDefinitions($owner:MetafieldOwnerType!,$namespace:String!) { metafieldDefinitions(first:100,namespace:$namespace,ownerType:$owner) { nodes { id key type { name } access { storefront } } } }`,
        { namespace, owner: ownerType }
      );
      const definitions = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              access: Schema.Struct({
                storefront: Schema.NullOr(Schema.String),
              }),
              id: Schema.String,
              key: Schema.String,
              type: Schema.Struct({ name: Schema.String }),
            })
          ),
        })
      )(data.metafieldDefinitions).pipe(
        Effect.mapError(() => fail("Invalid metafield definitions response"))
      );
      const existing = definitions.nodes.find((item) => item.key === key);
      if (existing?.id !== trackedId) {
        return yield* fail(
          `Metafield definition ${ownerType}/${namespace}/${key} differs from its tracking record`
        );
      }
      if (existing === undefined) {
        const result = yield* mutation(
          "metafieldDefinitionCreate",
          `mutation SeedDefinition($definition:MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition:$definition) { createdDefinition { id } userErrors { message } } }`,
          {
            definition: {
              ...definition,
              access: { storefront: "PUBLIC_READ" },
            },
          }
        );
        const resource = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ id: Schema.NonEmptyString })
        )(result.createdDefinition).pipe(
          Effect.mapError(() =>
            fail("Shopify did not return the metafield definition ID")
          )
        );
        return resource.id;
      }
      if (existing.type.name !== definition.type) {
        return yield* fail(
          `Incompatible metafield definition: ${ownerType}/${key}`
        );
      }
      if (existing.access.storefront !== "PUBLIC_READ") {
        yield* mutation(
          "metafieldDefinitionUpdate",
          `mutation SeedDefinitionAccess($definition:MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition:$definition) { userErrors { message } } }`,
          {
            definition: {
              access: { storefront: "PUBLIC_READ" },
              key,
              namespace,
              ownerType,
            },
          }
        );
      }
      return existing.id;
    }
  );
  const ensureCollection = Effect.fn("ShopifyCatalog.ensureCollection")(
    function* (name: CatalogName, trackedId?: string) {
      const handle = collectionHandle(name);
      const data = yield* request(
        "collection",
        `query SeedCollection($handle:String!) { collectionByHandle(handle:$handle) { id metafield(namespace:"commerce",key:"seedCatalog") { value } } }`,
        { handle }
      );
      const existing = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(
          Schema.Struct({
            id: Schema.String,
            metafield: Schema.NullOr(Schema.Struct({ value: Schema.String })),
          })
        )
      )(data.collectionByHandle).pipe(
        Effect.mapError(() => fail("Invalid catalog collection response"))
      );
      if ((existing?.id ?? undefined) !== trackedId) {
        return yield* fail(
          `Shopify Collection ${handle} differs from its tracking record`
        );
      }
      if (existing !== null) {
        if (existing.metafield?.value !== name) {
          return yield* fail(
            "An existing collection is not owned by this seed catalog"
          );
        }
        return existing.id;
      }
      const result = yield* mutation(
        "collectionCreate",
        `mutation SeedCollection($input:CollectionInput!) { collectionCreate(input:$input) { collection { id } userErrors { message } } }`,
        {
          input: {
            handle,
            metafields: [
              {
                key: "seedCatalog",
                namespace: "commerce",
                type: "single_line_text_field",
                value: name,
              },
            ],
            title: collectionTitle(name),
          },
        }
      );
      return (yield* Schema.decodeUnknownEffect(
        Schema.Struct({ id: Schema.String })
      )(result.collection).pipe(
        Effect.mapError(() => fail("Collection creation did not return an ID"))
      )).id;
    }
  );
  const translateFields = (
    id: string,
    fields: Readonly<Record<string, Readonly<Record<string, string>>>>
  ) =>
    Effect.gen(function* () {
      if (Object.keys(fields).length === 0) {
        return;
      }
      const response = yield* request(
        "translationContent",
        `query CatalogTranslation($id:ID!) { shopLocales { locale published } translatableResource(resourceId:$id) { translatableContent { key digest } } }`,
        { id }
      );
      const resource = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          translatableContent: Schema.Array(
            Schema.Struct({ digest: Schema.String, key: Schema.String })
          ),
        })
      )(response.translatableResource).pipe(
        Effect.mapError(() => fail("Unable to read translation digests"))
      );
      const locales = yield* Schema.decodeUnknownEffect(
        Schema.Array(
          Schema.Struct({ locale: Schema.String, published: Schema.Boolean })
        )
      )(response.shopLocales).pipe(
        Effect.mapError(() => fail("Unable to read translation locales"))
      );
      const translations = [];
      const nativeLocales = new Set<string>();
      for (const [locale, translation] of Object.entries(fields)) {
        const native = yield* Effect.try({
          catch: () => fail(`Shopify locale is unavailable: ${locale}`),
          try: () =>
            shopifyLocale(
              locale,
              locales
                .filter(({ published }) => published)
                .map(({ locale: key }) => key)
            ),
        });
        if (nativeLocales.has(native)) {
          return yield* fail(
            `Shopify locale collision for ${locale}; regional variants require an explicit Market translation strategy`
          );
        }
        nativeLocales.add(native);
        for (const [key, value] of Object.entries(translation)) {
          const digest = resource.translatableContent.find(
            (field) => field.key === key
          )?.digest;
          if (digest === undefined) {
            return yield* fail(
              `Shopify did not return the ${key} translation digest`
            );
          }
          translations.push({
            key,
            locale: native,
            translatableContentDigest: digest,
            value,
          });
        }
      }
      yield* mutation(
        "translationsRegister",
        `mutation CatalogTranslations($id:ID!,$translations:[TranslationInput!]!) { translationsRegister(resourceId:$id,translations:$translations) { userErrors { message } } }`,
        { id, translations }
      );
    });
  const translate = (
    id: string,
    content: Pick<CatalogCategory, "translations">
  ) =>
    translateFields(
      id,
      Object.fromEntries(
        Object.entries(content.translations).map(([locale, translated]) => [
          locale,
          {
            body_html: htmlText(translated.description),
            title: translated.title,
          },
        ])
      )
    );
  const completeProductOptions = (
    catalogName: CatalogName,
    id: string,
    product: ShopifyProductTranslation
  ) =>
    Effect.gen(function* () {
      const labels = productOptionTranslations(
        product,
        catalogTranslationLocales(readCatalog(catalogName))
      );
      const response = yield* request(
        "optionBindings",
        `query CatalogOptionBindings($id:ID!) { product(id:$id) { options { id position optionValues { id } } variants(first:20) { nodes { sku selectedOptions { optionValue { id } } } pageInfo { hasNextPage } } } }`,
        { id }
      );
      const native = yield* Schema.decodeUnknownEffect(OptionResources)(
        response.product
      ).pipe(Effect.mapError(() => fail("Unable to read Shopify option IDs")));
      const bindings = yield* Effect.try({
        catch: (error) =>
          fail(
            error instanceof Error
              ? error.message
              : "Unable to bind Shopify option IDs"
          ),
        try: () => bindProductOptions(product, native),
      });
      const bindingValue = yield* Schema.encodeEffect(
        Schema.fromJsonString(OptionBindings)
      )(bindings).pipe(Effect.orDie);
      yield* mutation(
        "metafieldsSet",
        `mutation CatalogOptionIds($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { userErrors { message } } }`,
        {
          metafields: [
            {
              key: "optionBindings",
              namespace: "commerce_shopify",
              ownerId: id,
              type: "json",
              value: bindingValue,
            },
          ],
        }
      );
      for (const option of labels) {
        const target = bindings[option.key];
        if (target === undefined) {
          return yield* fail(`Missing bound option: ${option.key}`);
        }
        yield* translateFields(target.id, option.translations);
        for (const value of option.values) {
          if (Object.keys(value.translations).length === 0) {
            continue;
          }
          const valueId = target.values[value.key];
          if (valueId !== undefined) {
            yield* translateFields(valueId, value.translations);
          }
        }
      }
    });
  const upsertCategory = (
    name: CatalogName,
    category: CatalogCategory,
    trackedId?: string
  ) =>
    Effect.gen(function* () {
      const response = yield* request(
        "category",
        `query CatalogCategory($handle:String!) { collectionByHandle(handle:$handle) { id owner:metafield(namespace:"commerce",key:"seedCatalog") { value } category:metafield(namespace:"commerce",key:"seedCategory") { value } } }`,
        { handle: category.key }
      );
      const current = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(
          Schema.Struct({
            category: Schema.NullOr(Schema.Struct({ value: Schema.String })),
            id: Schema.String,
            owner: Schema.NullOr(Schema.Struct({ value: Schema.String })),
          })
        )
      )(response.collectionByHandle).pipe(
        Effect.mapError(() => fail("Invalid category collection response"))
      );
      if ((current?.id ?? undefined) !== trackedId) {
        return yield* fail(
          `Shopify Category ${category.key} differs from its tracking record`
        );
      }
      if (
        current !== null &&
        (current.owner?.value !== name ||
          current.category?.value !== category.key)
      ) {
        return yield* fail(
          `Collection is not owned by this category: ${category.key}`
        );
      }
      const base = {
        descriptionHtml: htmlText(category.description),
        handle: category.key,
        title: category.title,
      };
      const result =
        current === null
          ? yield* mutation(
              "collectionCreate",
              `mutation CatalogCategoryCreate($input:CollectionInput!) { collectionCreate(input:$input) { collection { id } userErrors { message } } }`,
              {
                input: {
                  ...base,
                  metafields: [
                    {
                      key: "seedCatalog",
                      namespace: "commerce",
                      type: "single_line_text_field",
                      value: name,
                    },
                    {
                      key: "seedCategory",
                      namespace: "commerce",
                      type: "single_line_text_field",
                      value: category.key,
                    },
                  ],
                },
              }
            )
          : yield* mutation(
              "collectionUpdate",
              `mutation CatalogCategoryUpdate($input:CollectionInput!) { collectionUpdate(input:$input) { collection { id } userErrors { message } } }`,
              { input: { ...base, id: current.id } }
            );
      const collection = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ id: Schema.String })
      )(result.collection).pipe(
        Effect.mapError(() => fail("Category write did not return an ID"))
      );
      return collection.id;
    });
  const createImage = Effect.fn("ShopifyCatalog.createImage")(function* (
    productKey: string,
    image: CatalogImage
  ) {
    const filename = yield* Effect.try({
      catch: () =>
        fail(
          "Shopify catalog images require a source URL with an explicit filename extension"
        ),
      try: () => imageFilename({ key: productKey }, image),
    });
    const result = yield* mutation(
      "fileCreate",
      `mutation CatalogImageCreate($files:[FileCreateInput!]!) { fileCreate(files:$files) { files { __typename id } userErrors { message } } }`,
      {
        files: [
          {
            alt: image.altText ?? "",
            contentType: "IMAGE",
            duplicateResolutionMode: "RAISE_ERROR",
            filename,
            originalSource: image.url,
          },
        ],
      }
    );
    const [file] = yield* Schema.decodeUnknownEffect(
      Schema.Tuple([
        Schema.Struct({
          __typename: Schema.Literal("MediaImage"),
          id: Schema.NonEmptyString,
        }),
      ])
    )(result.files).pipe(
      Effect.mapError(() => fail("Shopify did not return the created image ID"))
    );
    return file.id;
  });

  const readyImageId = Effect.fn("ShopifyCatalog.readyImageId")(function* (
    id: string
  ) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = yield* request(
        "Read tracked image",
        `query CatalogImageStatus($id:ID!) { node(id:$id) { ... on MediaImage { id fileStatus } } }`,
        { id }
      );
      const file = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(
          Schema.Struct({ id: Schema.String, fileStatus: Schema.String })
        )
      )(result.node).pipe(
        Effect.mapError(() => fail(`Invalid Shopify image response for ${id}`))
      );
      if (file?.id === id && file.fileStatus === "READY") {
        return id;
      }
      if (file?.fileStatus === "FAILED") {
        return yield* fail(`Shopify failed to process tracked image ${id}`);
      }
      if (attempt < 5) {
        yield* Effect.sleep("2 seconds");
      }
    }
    return yield* fail(`Shopify image ${id} is not ready yet`);
  });
  const upsertProduct = Effect.fn("ShopifyCatalog.upsertProduct")(function* (
    name: CatalogName,
    product: Omit<CatalogProductContent, "translations">,
    imageIds: ReadonlyMap<string, string>,
    trackedId?: string
  ) {
    if (product.variants.length > 20) {
      return yield* fail(
        "This starter import supports at most 20 variants per product; split or extend the paginated importer before importing this product"
      );
    }
    const existing = yield* readProduct(
      trackedId === undefined ? { handle: product.key } : { id: trackedId }
    );
    if ((existing?.id ?? undefined) !== trackedId) {
      return yield* fail(
        `Shopify Product ${product.key} differs from its tracking record`
      );
    }
    if (existing !== null) {
      yield* assertOwned(existing, name);
      if (
        existing.variants.nodes.some(
          (variant) =>
            !product.variants.some((input) => input.sku === variant.sku)
        )
      ) {
        return yield* fail(
          `Unexpected variants on seed product: ${product.key}; reconcile them before importing`
        );
      }
    }
    const selection = productOptions(product);
    const fields = [
      {
        key: "productType",
        namespace: "commerce",
        type: "single_line_text_field",
        value: product.productType,
      },
    ];
    const fileInputs = new Map<
      string,
      { readonly id: string; readonly alt: string }
    >();
    for (const image of productImages(product)) {
      const id = imageIds.get(image.url);
      if (!id) {
        return yield* fail(`No tracked Shopify File for ${image.url}`);
      }
      fileInputs.set(image.url, {
        alt: image.altText ?? "",
        id: yield* readyImageId(id),
      });
    }
    const input = {
      descriptionHtml: htmlText(product.description),
      files: [...fileInputs.values()],
      handle: product.key,
      metafields: mergeMetafields(existing?.metafields.nodes ?? [], fields),
      productOptions: selection,
      productType: product.productType,
      status: "ACTIVE",
      tags: [...new Set([...(existing?.tags ?? []), managedTag(name)])],
      title: product.title,
      variants: product.variants.map((variant) => {
        const current = existing?.variants.nodes.find(
          (item) => item.sku === variant.sku
        );
        const mapped = {
          compareAtPrice:
            variant.price.discounted === undefined
              ? null
              : shopifyMoney(variant.price.regular),
          inventoryItem: { tracked: true },
          inventoryPolicy: "DENY",
          metafields: mergeMetafields(
            (current?.metafields.nodes ?? []).filter(
              (field) =>
                field.namespace !== "commerce" ||
                !modelMetafields().some(
                  (mapping) =>
                    mapping.productType === product.productType &&
                    mapping.key === field.key &&
                    mapping.type !== "product_reference" &&
                    mapping.type !== "list.product_reference"
                ) ||
                Object.hasOwn(variant.attributes, field.key)
            ),
            toMetafields(variant.attributes, product.productType)
          ),
          optionValues: variantOptions(product, variant),
          price: shopifyMoney(
            variant.price.discounted ?? variant.price.regular
          ),
          sku: variant.sku,
        };
        const [primary] = variant.images;
        const file =
          primary === undefined ? undefined : fileInputs.get(primary.url);
        const withFile = file === undefined ? mapped : { ...mapped, file };
        return current === undefined
          ? withFile
          : { ...withFile, id: current.id };
      }),
    };
    const result = yield* mutation(
      "productSet",
      `mutation SeedProduct($identifier:ProductSetIdentifiers,$input:ProductSetInput!) { productSet(identifier:$identifier,input:$input,synchronous:true) { product { id } userErrors { message } } }`,
      {
        ...(trackedId === undefined ? {} : { identifier: { id: trackedId } }),
        input,
      }
    );
    const written = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ id: Schema.NonEmptyString })
    )(result.product).pipe(
      Effect.mapError(() => fail("Product import did not return an ID"))
    );
    if (trackedId !== undefined && written.id !== trackedId) {
      return yield* fail(
        "Shopify returned a different Product ID after update"
      );
    }
    return written.id;
  });
  const trackedProduct = Effect.fn("ShopifyCatalog.trackedProduct")(function* (
    name: CatalogName,
    key: string,
    id: string,
    locationId?: string
  ) {
    const current = yield* readProduct({ id }, locationId);
    if (current === null || current.id !== id) {
      return yield* fail(
        `Tracked catalog Product is missing or has changed identity: ${key}`
      );
    }
    yield* assertOwned(current, name);
    return current;
  });
  const addCollectionProduct = Effect.fn("ShopifyCatalog.addCollectionProduct")(
    function* (collectionId: string, productId: string) {
      const membership = yield* request(
        "collectionMembership",
        `query SeedMembership($id:ID!,$product:ID!) { collection(id:$id) { hasProduct(id:$product) } }`,
        { id: collectionId, product: productId }
      );
      const collection = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ hasProduct: Schema.Boolean })
      )(membership.collection).pipe(
        Effect.mapError(() => fail("Tracked catalog collection is missing"))
      );
      if (!collection.hasProduct) {
        yield* mutation(
          "collectionAddProducts",
          `mutation SeedMembership($id:ID!,$product:ID!) { collectionAddProducts(id:$id,productIds:[$product]) { userErrors { message } } }`,
          { id: collectionId, product: productId }
        );
      }
    }
  );
  const addCategories = Effect.fn("ShopifyCatalog.addCategories")(function* (
    name: CatalogName,
    productKey: string,
    productId: string,
    categoryIds: readonly string[]
  ) {
    yield* trackedProduct(name, productKey, productId);
    for (const categoryId of categoryIds) {
      yield* addCollectionProduct(categoryId, productId);
    }
  });
  const assignReferences = Effect.fn("ShopifyCatalog.assignReferences")(
    function* (
      name: CatalogName,
      product: CatalogProductReferences,
      productId: string,
      relatedIds: readonly string[],
      referenceIds: Readonly<Record<string, string>>
    ) {
      const current = yield* trackedProduct(name, product.key, productId);
      for (const variant of product.variants) {
        const target = current.variants.nodes.find(
          ({ sku }) => sku === variant.sku
        );
        if (!target) {
          return yield* fail(`Imported variant is missing: ${variant.sku}`);
        }
        const referenceFields = productTypeDefinition(
          product.productType
        ).attributes.filter(
          (attribute) =>
            attribute.type === "product-reference" &&
            attribute.key !== "relatedProducts"
        );
        const metafields = referenceFields
          .filter(
            (attribute) => variant.attributes[attribute.key] !== undefined
          )
          .map((attribute) => {
            const raw = variant.attributes[attribute.key];
            const resolve = (key: string) => {
              const id = referenceIds[key];
              if (id === undefined) {
                throw new Error(`Unresolved product reference: ${key}`);
              }
              return id;
            };
            const value = attribute.list
              ? JSON.stringify(
                  Schema.decodeUnknownSync(Schema.Array(Schema.String))(
                    raw
                  ).map(resolve)
                )
              : resolve(Schema.decodeUnknownSync(Schema.String)(raw));
            const field = attributeField(product.productType, attribute.key);
            return {
              key: field.key,
              namespace: "commerce",
              ownerId: target.id,
              type: field.type,
              value,
            };
          });
        if (metafields.length > 0) {
          yield* mutation(
            "metafieldsSet",
            `mutation CatalogVariantReferences($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { userErrors { message } } }`,
            { metafields }
          );
        }
        const removed = referenceFields.flatMap((attribute) => {
          const { key } = attributeField(product.productType, attribute.key);
          return variant.attributes[attribute.key] === undefined &&
            target.metafields.nodes.some(
              (field) => field.namespace === "commerce" && field.key === key
            )
            ? [{ key, namespace: "commerce", ownerId: target.id }]
            : [];
        });
        for (const metafield of removed) {
          yield* mutation(
            "metafieldsDelete",
            `mutation RemoveCatalogVariantReferences($metafields:[MetafieldIdentifierInput!]!) { metafieldsDelete(metafields:$metafields) { userErrors { message } } }`,
            { metafields: [metafield] }
          );
        }
      }
      if (
        productTypeDefinition(product.productType).attributes.some(
          ({ key }) => key === "relatedProducts"
        )
      ) {
        yield* mutation(
          "metafieldsSet",
          `mutation SeedReferences($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { userErrors { message } } }`,
          {
            metafields: [
              {
                key: "relatedProducts",
                namespace: "commerce",
                ownerId: productId,
                type: "list.product_reference",
                value: JSON.stringify(relatedIds),
              },
            ],
          }
        );
      }
    }
  );
  const assignGallery = Effect.fn("ShopifyCatalog.assignGallery")(function* (
    name: CatalogName,
    productKey: string,
    productId: string,
    sku: string,
    imageIds: readonly string[]
  ) {
    const current = yield* trackedProduct(name, productKey, productId);
    const target = current.variants.nodes.find(
      (variant) => variant.sku === sku
    );
    if (!target) {
      return yield* fail(`Imported variant is missing: ${sku}`);
    }
    yield* mutation(
      "metafieldsSet",
      `mutation CatalogVariantImages($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { userErrors { message } } }`,
      {
        metafields: [
          {
            key: "variantImages",
            namespace: "commerce",
            ownerId: target.id,
            type: "list.file_reference",
            value: JSON.stringify(imageIds),
          },
        ],
      }
    );
    return target.id;
  });
  const upsertInventory = Effect.fn("ShopifyCatalog.upsertInventory")(
    function* (
      name: CatalogName,
      productKey: string,
      productId: string,
      sku: string,
      quantity: number
    ) {
      const { locationId } = yield* options.settings;
      if (locationId === undefined) {
        return yield* fail(
          "Configure SHOPIFY_CATALOG_LOCATION_ID to seed stock"
        );
      }
      const current = yield* trackedProduct(
        name,
        productKey,
        productId,
        locationId
      );
      const target = current.variants.nodes.find(
        (variant) => variant.sku === sku
      );
      if (!target?.inventoryItem) {
        return yield* fail(`Imported variant is missing: ${sku}`);
      }
      const level = target.inventoryItem.inventoryLevel;
      if (level === null) {
        yield* mutation(
          "inventoryActivate",
          `mutation SeedStock($item:ID!,$location:ID!,$available:Int!,$idempotencyKey:String!) { inventoryActivate(inventoryItemId:$item,locationId:$location,available:$available) @idempotent(key:$idempotencyKey) { userErrors { message } } }`,
          {
            available: quantity,
            idempotencyKey: randomUUID(),
            item: target.inventoryItem.id,
            location: locationId,
          }
        );
      } else {
        const available = level.quantities.find(
          (quantity) => quantity.name === "available"
        )?.quantity;
        if (available === undefined) {
          return yield* fail(
            "Inventory level did not report available quantity"
          );
        }
        if (available !== quantity) {
          yield* mutation(
            "inventorySetQuantities",
            `mutation SeedStock($input:InventorySetQuantitiesInput!,$idempotencyKey:String!) { inventorySetQuantities(input:$input) @idempotent(key:$idempotencyKey) { userErrors { message } } }`,
            {
              idempotencyKey: randomUUID(),
              input: {
                name: "available",
                quantities: [
                  {
                    changeFromQuantity: available,
                    inventoryItemId: target.inventoryItem.id,
                    locationId,
                    quantity,
                  },
                ],
                reason: "correction",
              },
            }
          );
        }
      }
      return target.inventoryItem.id;
    }
  );
  const translateProduct = Effect.fn("ShopifyCatalog.translateProduct")(
    function* (
      name: CatalogName,
      product: ShopifyProductTranslation,
      id: string
    ) {
      yield* translate(id, product);
      yield* completeProductOptions(name, id, product);
    }
  );
  const publish = Effect.fn("ShopifyCatalog.publish")(function* (id: string) {
    const settings = yield* options.settings;
    yield* mutation(
      "publishablePublish",
      `mutation SeedPublication($id:ID!,$input:[PublicationInput!]!) { publishablePublish(id:$id,input:$input) { userErrors { message } } }`,
      { id, input: [{ publicationId: settings.publicationId }] }
    );
  });
  return {
    addCollectionProduct,
    addCategories,
    assignGallery,
    createImage,
    assignReferences,
    ensureCollection,
    ensureDefinition,
    ensureLocale,
    ensureStoreAttribution: (trackedId?: string) =>
      provisionStoreAttribution(admin, trackedId),
    preflight,
    publish,
    translateCategory: (id: string, category: CatalogCategory) =>
      translate(id, category),
    translateProduct,
    upsertCategory,
    upsertInventory,
    upsertProduct,
  };
};
export type CatalogDestination = ReturnType<typeof makeCatalogDestination>;
