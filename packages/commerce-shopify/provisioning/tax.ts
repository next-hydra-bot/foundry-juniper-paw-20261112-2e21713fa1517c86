import { readSourceFile } from "@repo/cli-core/json-migrations";
import { validateTaxClassMappings } from "@repo/commerce-core/catalog/tax";
import type { CatalogTaxSetup } from "@repo/commerce-core/catalog/tax";
import {
  loadProvisioningCatalog,
  readProfileDocument,
} from "@repo/commerce-core/provisioning/pipeline";
import type {
  CustomerProvisioningTargets,
  ProfilePreparation,
  ProvisioningCatalog,
  ProvisioningStore,
} from "@repo/commerce-core/provisioning/pipeline";
import {
  loadTaxSetup,
  makeTaxDefinition,
} from "@repo/commerce-core/provisioning/tax";
import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";
import type { Tracking } from "migrate-sdk";

import type { CatalogAdmin } from "../catalog/admin";

export const ShopifyTaxConfig = Schema.Struct({
  classes: Schema.NonEmptyArray(
    Schema.Struct({
      taxClassKey: Schema.NonEmptyString,
      taxable: Schema.Boolean,
    })
  ),
  expectedShopSettings: Schema.Struct({
    taxesIncluded: Schema.Boolean,
    taxShipping: Schema.Boolean,
  }),
  productCategories: Schema.Array(
    Schema.Struct({
      productKey: Schema.NonEmptyString,
      categoryId: Schema.String.check(
        Schema.isPattern(/^gid:\/\/shopify\/TaxonomyCategory\/[^/]+$/u)
      ),
    })
  ),
});
export type ShopifyTaxConfig = typeof ShopifyTaxConfig.Type;

export const validateTaxConfig = (
  setup: CatalogTaxSetup,
  config: ShopifyTaxConfig
) => {
  validateTaxClassMappings(
    setup,
    config.classes.map(({ taxClassKey }) => taxClassKey)
  );
  if (
    new Set(config.productCategories.map(({ productKey }) => productKey))
      .size !== config.productCategories.length ||
    config.productCategories.some(
      ({ productKey }) =>
        !setup.products.some(
          (assignment) => assignment.productKey === productKey
        )
    )
  ) {
    throw new Error(
      "Shopify product category mappings must have unique keys and reference assigned Products."
    );
  }
};

export const applyTaxSetup = <R>(
  admin: CatalogAdmin<R>,
  setup: CatalogTaxSetup,
  config: ShopifyTaxConfig,
  products: ReadonlyMap<string, string>
) =>
  Effect.gen(function* () {
    const shop = yield* admin
      .request(
        "readShopTaxSettings",
        "query TaxSetup { shop { taxesIncluded taxShipping } }"
      )
      .pipe(
        Effect.flatMap((data) =>
          Schema.decodeUnknownEffect(
            Schema.Struct({
              taxShipping: Schema.Boolean,
              taxesIncluded: Schema.Boolean,
            })
          )(data.shop)
        ),
        Effect.mapError((cause) =>
          cause instanceof DestinationError
            ? cause
            : new DestinationError({
                cause,
                message: "Invalid Shopify shop tax settings response.",
              })
        )
      );
    if (
      shop.taxesIncluded !== config.expectedShopSettings.taxesIncluded ||
      shop.taxShipping !== config.expectedShopSettings.taxShipping
    ) {
      return yield* new DestinationError({
        message: `Shopify tax settings differ from --tax-config. Set price tax inclusion to ${config.expectedShopSettings.taxesIncluded} and shipping tax to ${config.expectedShopSettings.taxShipping} in Settings > Taxes and duties, then rerun.`,
      });
    }
    for (const assignment of setup.products) {
      const mapping = config.classes.find(
        ({ taxClassKey }) => taxClassKey === assignment.taxClassKey
      );
      if (!mapping) {
        return yield* new DestinationError({
          message: `Missing Shopify Tax Class mapping: ${assignment.taxClassKey}`,
        });
      }
      const productId = products.get(assignment.productKey);
      if (!productId) {
        return yield* new DestinationError({
          message: `Missing tracked Product: ${assignment.productKey}`,
        });
      }
      const data = yield* admin.request(
        "readProductTaxes",
        "query ProductTaxes($id:ID!) { product(id:$id) { id category { id } variants(first:250) { nodes { id taxable } pageInfo { hasNextPage } } } }",
        { id: productId }
      );
      const product = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(
          Schema.Struct({
            category: Schema.NullOr(
              Schema.Struct({ id: Schema.NonEmptyString })
            ),
            id: Schema.NonEmptyString,
            variants: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  id: Schema.NonEmptyString,
                  taxable: Schema.Boolean,
                })
              ),
              pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
            }),
          })
        )
      )(data.product).pipe(
        Effect.mapError(
          (cause) =>
            new DestinationError({
              cause,
              message: `Invalid Shopify Product tax response: ${assignment.productKey}`,
            })
        )
      );
      if (
        !product ||
        product.variants.pageInfo.hasNextPage ||
        product.variants.nodes.length === 0
      ) {
        return yield* new DestinationError({
          message: `Product unavailable or exceeds the catalog importer's variant limit: ${assignment.productKey}`,
        });
      }
      const category = config.productCategories.find(
        ({ productKey }) => productKey === assignment.productKey
      );
      if (category && product.category?.id !== category.categoryId) {
        yield* admin.mutation(
          "productUpdate",
          "mutation ProductTaxCategory($product:ProductUpdateInput!) { productUpdate(product:$product) { product { id } userErrors { message } } }",
          { product: { category: category.categoryId, id: product.id } }
        );
      }
      const variants = product.variants.nodes
        .filter(({ taxable }) => taxable !== mapping.taxable)
        .map(({ id }) => ({ id, taxable: mapping.taxable }));
      if (variants.length) {
        yield* admin.mutation(
          "productVariantsBulkUpdate",
          "mutation VariantTaxability($productId:ID!,$variants:[ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId:$productId,variants:$variants,allowPartialUpdates:false) { productVariants { id } userErrors { message } } }",
          { productId: product.id, variants }
        );
      }
    }
    yield* Effect.logInfo(
      "Shopify product tax settings applied. Tax registrations, collection regions and shipping tax overrides must be configured in Shopify Admin; this command does not verify them."
    );
  });

export const withTaxSetup = <T extends CustomerProvisioningTargets>(
  options: ProfilePreparation,
  targets: T,
  admin: CatalogAdmin<Tracking>
) =>
  Effect.gen(function* () {
    const tax = yield* loadTaxSetup(options);
    if (!tax) {
      return targets;
    }
    const loadConfig = readProfileDocument(
      ShopifyTaxConfig,
      tax.configFile
    ).pipe(
      Effect.mapError(
        (cause) =>
          new DestinationError({
            cause,
            message: "Invalid Shopify --tax-config JSON.",
          })
      )
    );
    const config = yield* loadConfig;
    const readConfig = readSourceFile(loadConfig);
    const readTax = Effect.all({ setup: tax.read, config: readConfig }).pipe(
      Effect.mapError(
        (cause) =>
          new DestinationError({ cause, message: "Unable to read tax sources" })
      )
    );
    const readCatalog = readSourceFile(
      loadProvisioningCatalog(options.directory)
    );
    yield* Effect.try({
      catch: (cause) =>
        new DestinationError({
          cause,
          message:
            cause instanceof Error
              ? cause.message
              : "Invalid Shopify tax mappings.",
        }),
      try: () => {
        validateTaxConfig(tax.setup, config);
      },
    });
    return {
      ...targets,
      catalogDefinitions: (
        catalog: ProvisioningCatalog,
        store: ProvisioningStore
      ) => {
        const definitions = targets.catalogDefinitions(catalog, store);
        return [
          ...definitions,
          makeTaxDefinition({
            apply: (products) =>
              readTax.pipe(
                Effect.flatMap(({ setup, config }) =>
                  Effect.forEach(
                    setup.products.filter(({ productKey }) =>
                      products.has(productKey)
                    ),
                    (assignment) =>
                      applyTaxSetup(
                        admin,
                        { ...setup, products: [assignment] },
                        config,
                        products
                      ),
                    { discard: true }
                  )
                )
              ),
            dependencies: [],
            productDefinitions: definitions.filter(
              ({ id }) => id === `${catalog.files.catalogName}-products`
            ),
            readProducts: Effect.all({
              catalog: readCatalog,
              tax: readTax,
            }).pipe(
              Effect.map(({ catalog, tax: { setup, config } }) =>
                Object.entries(catalog.catalogs).flatMap(([name, source]) => {
                  const definition = definitions.find(
                    ({ id }) => id === `${name}-products`
                  );
                  if (!definition) {
                    throw new Error(
                      `Missing catalog Product definition: ${name}`
                    );
                  }
                  return source.products.map(({ key, variants }) => {
                    const taxClassKey = setup.products.find(
                      ({ productKey }) => productKey === key
                    )?.taxClassKey;
                    return {
                      definition,
                      key,
                      versionInputs: [
                        variants.map(({ sku }) => sku),
                        config.expectedShopSettings,
                        config.classes.find(
                          (item) => item.taxClassKey === taxClassKey
                        ) ?? null,
                        config.productCategories.find(
                          ({ productKey }) => productKey === key
                        ) ?? null,
                      ],
                    };
                  });
                })
              )
            ),
            revision: ["shopify-tax-v2"],
            store,
          }),
        ];
      },
    };
  });
