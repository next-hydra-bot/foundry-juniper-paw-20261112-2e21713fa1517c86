import { createHash } from "node:crypto";

import { documentRows } from "@repo/cli-core/json-migrations";
import type { DocumentRow } from "@repo/cli-core/json-migrations";
import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import { Array as EffectArray, Effect, Order, Schema } from "effect";
import type { Layer } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  SourceIdentity,
  Tracking,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationReferenceForDefinition,
  MigrationReferenceLookup,
  MigrationReferenceLookupTarget,
  MigrationStore,
  MigrationStoreError,
} from "migrate-sdk";

import type {
  CompanyLocationBinding,
  PricingGroupBinding,
  CompanyCatalogDestination,
} from "./b2b";
import { trackedShopifyRecord } from "./migrations";

const Identity = SourceIdentity.make({
  id: "shopify-company-resource-key@v1",
  schema: SourceIdentity.key("key", Schema.NonEmptyString),
});
const Resource = Schema.Struct({ id: Schema.NullOr(Schema.String) });
const Locations = Schema.Struct({ ids: Schema.Array(Schema.String) });
const Variants = Schema.Struct({
  ids: Schema.Record(Schema.String, Schema.String),
});
const ProductSkus = Schema.Struct({
  key: Schema.NonEmptyString,
  variants: Schema.Array(Schema.Struct({ sku: Schema.NonEmptyString })),
});
const FixedPrice = Schema.Struct({
  scope: Schema.NonEmptyString,
  productKey: Schema.NonEmptyString,
  sku: Schema.NonEmptyString,
  centAmount: Schema.Int,
  currency: Schema.NonEmptyString,
  topology: Schema.NonEmptyString,
  variantRevision: Schema.String,
});
const CompanyLocation = Schema.Struct({
  businessUnitKey: Schema.NonEmptyString,
  revision: Schema.NonEmptyString,
});
const fail = (message: string) => new DestinationError({ message });

const sourceKeys = (items: Iterable<string>) =>
  Array.from(items, (key) => ({ item: key, key }));
const fingerprint = (value: Schema.Json) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const priceKey = (scope: string, sku: string) => JSON.stringify([scope, sku]);
const variantRevision = (variants: readonly { readonly sku: string }[]) =>
  fingerprint(variants.map(({ sku }) => sku));
const priceRevision = (item: typeof FixedPrice.Type) =>
  fingerprint([
    item.topology,
    item.scope,
    item.productKey,
    item.sku,
    item.centAmount,
    item.currency,
    item.variantRevision,
  ]);

const versionedRecord = <A, I>(schema: Schema.Codec<A, I>) =>
  Schema.Struct({ revision: Schema.String, record: schema });

const saveRecord = (
  record: Readonly<Record<string, Schema.Json>>,
  revision: string
) => Tracking.setRecord({ revision, record });

export const makeCompanyCatalogMigrations = (options: {
  readonly group: string;
  readonly store: Layer.Layer<MigrationStore, MigrationStoreError>;
  readonly products: AnySelfContainedMigrationDefinition;
  readonly businessUnits?: readonly AnySelfContainedMigrationDefinition[];
  readonly readPlans: Effect.Effect<
    readonly CompanyCatalogPlan[],
    DestinationError
  >;
  readonly policies: readonly PricingGroupBinding[];
  readonly locationInput: (businessUnitKey: string) => Schema.Json;
  readonly sellingKey: string;
  readonly destination: CompanyCatalogDestination;
  readonly resolveBinding: (
    businessUnitKey: string
  ) => Effect.Effect<
    CompanyLocationBinding,
    DestinationError,
    MigrationReferenceLookup
  >;
}) => {
  const { destination, group, policies, store } = options;
  const read = options.readPlans.pipe(
    Effect.map((plans) => {
      const buyers = [
        ...new Set(plans.map(({ assignment }) => assignment.businessUnitKey)),
      ];
      const products = new Map(
        plans.flatMap(({ products }) =>
          products.map((product) => [product.key, product] as const)
        )
      );
      const scopes = new Map(
        policies.map((binding) => [
          `${binding.pricingGroupKey}/${binding.currency}`,
          {
            binding,
            plans: plans.filter(
              ({ priceList, pricingGroup }) =>
                priceList.currency === binding.currency &&
                pricingGroup.key === binding.pricingGroupKey
            ),
          },
        ])
      );
      const variantRevisions = new Map(
        [...products].map(([key, { variants }]) => [
          key,
          variantRevision(variants),
        ])
      );
      // Drafting and activation coordinate location moves. Prices alone do not change this revision.
      const topology = fingerprint([
        options.sellingKey,
        [...scopes].map(([key, { binding, plans: members }]) => [
          key,
          binding,
          EffectArray.sort(
            new Set(
              members.map(({ assignment }) => assignment.businessUnitKey)
            ),
            Order.String
          ).map((buyer) => [buyer, options.locationInput(buyer)]),
        ]),
      ]);
      const locationRevision = (key: string) =>
        fingerprint([topology, options.locationInput(key)]);
      const priceItems = [...scopes].flatMap(([scope, { binding, plans }]) => {
        const [plan] = plans;
        if (!plan) {
          return [];
        }
        const productsBySku = new Map(
          plans.flatMap(({ products }) =>
            products.flatMap(({ key, variants }) =>
              variants.map(({ sku }) => [sku, key] as const)
            )
          )
        );
        const pricesBySku = new Map(
          plan.priceList.prices.map(({ sku, centAmount }) => [sku, centAmount])
        );
        return Array.from(productsBySku, ([sku, productKey]) => ({
          key: priceKey(scope, sku),
          item: {
            scope,
            sku,
            productKey,
            centAmount: pricesBySku.get(sku) ?? -1,
            currency: binding.currency,
            topology,
            variantRevision: variantRevisions.get(productKey) ?? "",
          },
        }));
      });
      return {
        plans,
        buyers,
        products,
        scopes,
        topology,
        locationRevision,
        priceItems,
        scopeItems: sourceKeys(scopes.keys()),
      };
    })
  );
  type Pricing = Effect.Success<typeof read>;
  const source = <A>(
    schema: Schema.Codec<A, A>,
    select: (pricing: Pricing) => readonly DocumentRow<A>[],
    revision: (pricing: Pricing) => Schema.Json = ({ topology }) => topology
  ) =>
    documentRows(
      schema,
      read.pipe(
        Effect.map((pricing) =>
          select(pricing).map((row) => ({
            ...row,
            inputs: revision(pricing),
          }))
        )
      ),
      Identity
    );
  const versionedTracking = <R extends Readonly<Record<string, Schema.Json>>>(
    id: string,
    schema: Schema.Codec<R, R>
  ) =>
    Tracking.record({
      id: `shopify-company-${id}@v1`,
      schema: versionedRecord(schema),
    });
  const tracked = <Definition extends AnySelfContainedMigrationDefinition>(
    definition: Definition,
    key: MigrationReferenceLookupTarget<Definition>["sourceIdentityKey"],
    revision: string
  ): Effect.Effect<
    MigrationReferenceForDefinition<Definition>["trackingRecord"],
    DestinationError,
    MigrationReferenceLookup
  > =>
    Effect.gen(function* () {
      const value = yield* trackedShopifyRecord(definition, key);
      if (value.revision !== revision) {
        return yield* fail(
          `${definition.id}: ${key} belongs to a previous pricing revision. Run the full group to apply the new inputs.`
        );
      }
      return value;
    });
  const locations = MigrationDefinition.make({
    id: "b2b-company-locations",
    dependencies: {
      required: options.businessUnits?.map(({ id }) => id) ?? [],
    },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(
      CompanyLocation,
      ({ buyers, locationRevision }) =>
        buyers.map((key) => ({
          key,
          item: { businessUnitKey: key, revision: locationRevision(key) },
        })),
      () => null
    ),
    store,
    tracking: versionedTracking("locations", Locations),
    process: Effect.fn("ShopifyCompanyCatalog.locations")(function* ({
      item: {
        item: {
          payload: { businessUnitKey, revision },
        },
      },
    }) {
      const binding = yield* options.resolveBinding(businessUnitKey);
      const ids = yield* destination.readCompanyLocations(binding);
      yield* saveRecord({ ids }, revision);
    }),
  });
  const locationIds = Effect.fn("ShopifyCompanyCatalog.trackedLocations")(
    function* (
      members: readonly CompanyCatalogPlan[],
      locationRevision: Pricing["locationRevision"]
    ) {
      const keys = [
        ...new Set(members.map(({ assignment }) => assignment.businessUnitKey)),
      ];
      return new Map(
        yield* Effect.forEach(
          keys,
          (key) =>
            tracked(locations, key, locationRevision(key)).pipe(
              Effect.map(({ record }) => [key, record.ids] as const)
            ),
          { concurrency: 1 }
        )
      );
    }
  );
  const variants = MigrationDefinition.make({
    id: "b2b-company-product-variants",
    dependencies: { required: [options.products.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(
      ProductSkus,
      ({ products }) =>
        Array.from(products, ([key, product]) => ({
          key,
          item: { key, variants: product.variants.map(({ sku }) => ({ sku })) },
        })),
      () => null
    ),
    store,
    tracking: versionedTracking("product-variants", Variants),
    process: Effect.fn("ShopifyCompanyCatalog.productVariants")(function* ({
      item: {
        item: { payload: product },
      },
    }) {
      const { id } = yield* trackedShopifyRecord(options.products, product.key);
      if (!Schema.is(Schema.String)(id)) {
        return yield* fail(`Invalid tracked Shopify Product ${product.key}`);
      }
      const ids = yield* destination.readProductVariants(product, id);
      yield* saveRecord({ ids }, variantRevision(product.variants));
    }),
  });
  const preflight = MigrationDefinition.make({
    id: "b2b-company-pricing-preflight",
    dependencies: { required: [locations.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, () => sourceKeys([options.sellingKey])),
    store,
    tracking: versionedTracking("pricing-preflight", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.pricingPreflight")(function* ({
      item: {
        item: { payload: key },
      },
    }) {
      const { plans, locationRevision, topology } = yield* read;
      yield* destination.preflight(
        plans,
        yield* locationIds(plans, locationRevision)
      );
      yield* saveRecord({ id: key }, topology);
    }),
  });
  const scope = Effect.fn("ShopifyCompanyCatalog.scope")(function* (
    key: string,
    scopes: Pricing["scopes"]
  ) {
    const value = scopes.get(key);
    if (!value) {
      return yield* fail(`Unknown Shopify company pricing scope ${key}`);
    }
    return value;
  });
  const scopeIds = (
    members: readonly CompanyCatalogPlan[],
    locationRevision: Pricing["locationRevision"]
  ) =>
    locationIds(members, locationRevision).pipe(
      Effect.map((locations) => [...new Set([...locations.values()].flat())])
    );
  const markets = MigrationDefinition.make({
    id: "b2b-company-markets",
    dependencies: { required: [preflight.id, locations.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, ({ scopeItems }) => scopeItems),
    store,
    tracking: versionedTracking("markets", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.market")(function* (
      {
        item: {
          item: { payload: key },
        },
      },
      { previousState }
    ) {
      const { topology, scopes, locationRevision } = yield* read;
      yield* tracked(preflight, options.sellingKey, topology);
      const { binding, plans } = yield* scope(key, scopes);
      const id = yield* destination.ensureMarket(
        binding,
        yield* scopeIds(plans, locationRevision),
        previousState?.trackingRecord?.record.id
      );
      yield* saveRecord({ id }, topology);
    }),
  });
  const catalogs = MigrationDefinition.make({
    id: "b2b-company-catalogs",
    dependencies: { required: [markets.id, locations.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, ({ scopeItems }) => scopeItems),
    store,
    tracking: versionedTracking("catalogs", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.catalog")(function* (
      {
        item: {
          item: { payload: key },
        },
      },
      { previousState }
    ) {
      const { topology, scopes, locationRevision } = yield* read;
      const {
        record: { id: market },
      } = yield* tracked(markets, key, topology);
      const { binding, plans } = yield* scope(key, scopes);
      const id = market
        ? yield* destination.draftCatalog(
            binding,
            market,
            yield* scopeIds(plans, locationRevision),
            previousState?.trackingRecord?.record.id
          )
        : null;
      yield* saveRecord({ id }, topology);
    }),
  });
  const priceLists = MigrationDefinition.make({
    id: "b2b-company-price-lists",
    dependencies: { required: [markets.id, catalogs.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, ({ scopeItems }) => scopeItems),
    store,
    tracking: versionedTracking("price-lists", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.priceList")(function* (
      {
        item: {
          item: { payload: key },
        },
      },
      { previousState }
    ) {
      const { topology, scopes } = yield* read;
      const {
        record: { id: market },
      } = yield* tracked(markets, key, topology);
      const {
        record: { id: catalog },
      } = yield* tracked(catalogs, key, topology);
      const { binding, plans } = yield* scope(key, scopes);
      if (!plans.length) {
        return yield* saveRecord(
          {
            id: previousState?.trackingRecord?.record.id ?? null,
          },
          topology
        );
      }
      if (!market || !catalog) {
        return yield* fail(`Missing Shopify Market or Catalog for ${key}`);
      }
      const id = yield* destination.ensurePriceList(
        binding,
        market,
        catalog,
        previousState?.trackingRecord?.record.id
      );
      yield* saveRecord({ id }, topology);
    }),
  });
  const fixedPrices = MigrationDefinition.make({
    id: "b2b-company-fixed-prices",
    dependencies: { required: [priceLists.id, variants.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(
      FixedPrice,
      ({ priceItems }) => priceItems,
      () => null
    ),
    store,
    tracking: versionedTracking("fixed-prices", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.fixedPrice")(function* ({
      item: {
        item: { payload: item },
      },
    }) {
      const {
        scope: key,
        sku,
        productKey,
        centAmount,
        currency,
        topology,
      } = item;
      const {
        record: { id },
      } = yield* tracked(priceLists, key, topology);
      const {
        record: { ids },
      } = yield* tracked(variants, productKey, item.variantRevision);
      const variant = ids[sku];
      if (!id || !variant || centAmount < 0) {
        return yield* fail(
          `Missing Shopify Price List or variant for ${key}/${sku}`
        );
      }
      yield* destination.setFixedPrice(id, variant, centAmount, currency);
      yield* saveRecord({ id }, priceRevision(item));
    }),
  });
  const memberships = MigrationDefinition.make({
    id: "b2b-company-market-memberships",
    dependencies: {
      required: [markets.id, catalogs.id, fixedPrices.id, locations.id],
    },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, ({ scopeItems }) => scopeItems),
    store,
    tracking: versionedTracking("market-memberships", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.marketMembership")(function* ({
      item: {
        item: { payload: key },
      },
    }) {
      const { topology, scopes, scopeItems, priceItems, locationRevision } =
        yield* read;
      // All managed price Catalogs must be drafted before company locations move.
      for (const scope of scopeItems) {
        yield* tracked(catalogs, scope.key, topology);
      }
      yield* Effect.forEach(
        priceItems.filter(({ item }) => item.scope === key),
        ({ key, item }) => tracked(fixedPrices, key, priceRevision(item)),
        { discard: true }
      );
      const { binding, plans } = yield* scope(key, scopes);
      const {
        record: { id },
      } = yield* tracked(markets, key, topology);
      if (id) {
        yield* destination.updateMembership(
          binding,
          id,
          yield* scopeIds(plans, locationRevision)
        );
      }
      yield* saveRecord({ id }, topology);
    }),
  });
  const activation = MigrationDefinition.make({
    id: "b2b-company-catalog-activation",
    dependencies: { required: [catalogs.id, memberships.id, priceLists.id] },
    execution: { process: { concurrency: 1 } },
    group,
    source: source(Schema.String, ({ scopeItems }) => scopeItems),
    store,
    tracking: versionedTracking("catalog-activation", Resource),
    process: Effect.fn("ShopifyCompanyCatalog.catalogActivation")(function* ({
      item: {
        item: { payload: key },
      },
    }) {
      const { topology, scopes, scopeItems } = yield* read;
      // Keep company prices unavailable until all membership moves have settled.
      for (const scope of scopeItems) {
        yield* tracked(memberships, scope.key, topology);
      }
      const { binding, plans } = yield* scope(key, scopes);
      const {
        record: { id },
      } = yield* tracked(catalogs, key, topology);
      const {
        record: { id: market },
      } = yield* tracked(memberships, key, topology);
      if (id && market && plans.length) {
        const {
          record: { id: priceListId },
        } = yield* tracked(priceLists, key, topology);
        if (!priceListId) {
          return yield* fail(`Missing Shopify Price List for ${key}`);
        }
        yield* destination.activateCatalog(binding, market, id, priceListId);
      }
      yield* saveRecord({ id }, topology);
    }),
  });
  return [
    locations,
    variants,
    preflight,
    markets,
    catalogs,
    priceLists,
    fixedPrices,
    memberships,
    activation,
  ];
};
