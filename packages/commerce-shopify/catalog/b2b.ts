import type { CompanyCatalogPlan } from "@repo/commerce-core/catalog/company";
import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Plain Admin transport factory.
import { journalCatalogAdmin, makeCatalogAdmin } from "./admin";
import type { CatalogSettings } from "./destination";
import { shopifyMoney } from "./mapping";

const nativeId = (type: string) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^gid://shopify/${type}/\\d+$`, "u"))
  );
const MarketBinding = Schema.Struct({
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  marketHandle: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/u)),
  marketId: Schema.optional(nativeId("Market")),
  marketName: Schema.NonEmptyString,
});
export const CompanyCatalogBindings = Schema.Struct({
  companies: Schema.NonEmptyArray(
    Schema.Struct({
      businessUnitKey: Schema.NonEmptyString,
      companyId: nativeId("Company"),
      companyLocationIds: Schema.optional(
        Schema.NonEmptyArray(nativeId("CompanyLocation"))
      ),
    })
  ),
  pricingGroups: Schema.NonEmptyArray(
    Schema.Struct({
      ...MarketBinding.fields,
      pricingGroupKey: Schema.NonEmptyString,
    })
  ),
});
export type CompanyCatalogBindings = typeof CompanyCatalogBindings.Type;
export type CompanyLocationBinding =
  CompanyCatalogBindings["companies"][number];
export type PricingGroupBinding =
  CompanyCatalogBindings["pricingGroups"][number];
type CompanyMarketActivation = {
  name: string;
  status: "ACTIVE";
  conditions?: {
    conditionsToAdd?: {
      companyLocationsCondition: { companyLocationIds: string[] };
    };
    conditionsToDelete?: {
      companyLocationsCondition: { companyLocationIds: string[] };
    };
  };
};
const Resource = Schema.Struct({ id: Schema.String });
const CatalogResource = Schema.Struct({
  id: Schema.String,
  priceList: Schema.NullOr(
    Schema.Struct({ currency: Schema.String, id: Schema.String })
  ),
  publication: Schema.NullOr(Resource),
  status: Schema.String,
  title: Schema.String,
});
const catalogFields = `id title status publication { id } priceList { id currency }`;
const Connection = <A extends Schema.Top>(node: A) =>
  Schema.Struct({
    nodes: Schema.Array(node),
    pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
  });
const MarketResource = Schema.Struct({
  catalogs: Connection(CatalogResource),
  conditions: Schema.NullOr(
    Schema.Struct({
      companyLocationsCondition: Schema.NullOr(
        Schema.Struct({
          applicationLevel: Schema.NullOr(Schema.String),
          companyLocations: Connection(Resource),
        })
      ),
      conditionTypes: Schema.Array(Schema.String),
    })
  ),
  currencySettings: Schema.NullOr(
    Schema.Struct({
      baseCurrency: Schema.Struct({ currencyCode: Schema.String }),
      localCurrencies: Schema.Boolean,
    })
  ),
  handle: Schema.String,
  id: Schema.String,
  status: Schema.String,
});
const marketFields = `id handle status conditions { conditionTypes companyLocationsCondition { applicationLevel companyLocations(first:250) { nodes { id } pageInfo { hasNextPage } } } } currencySettings { baseCurrency { currencyCode } localCurrencies } catalogs(first:50) { nodes { ${catalogFields} } pageInfo { hasNextPage } }`;
const fail = (message: string) => new DestinationError({ message });
const scopeKey = (key: string, currency: string) => `${key}/${currency}`;

/** Provider policy configuration is validated without inventing native company IDs. */
export const validateCompanyCatalogPolicies = (
  bindings: Pick<CompanyCatalogBindings, "pricingGroups">,
  plans: readonly CompanyCatalogPlan[]
) => {
  const groups = new Set(
    plans.map((plan) =>
      scopeKey(plan.pricingGroup.key, plan.priceList.currency)
    )
  );
  const actual = bindings.pricingGroups.map((binding) =>
    scopeKey(binding.pricingGroupKey, binding.currency)
  );
  if (
    new Set(actual).size !== actual.length ||
    [...groups].some((key) => !actual.includes(key))
  ) {
    throw new Error(
      "Provide one Shopify binding for every pricing group/currency."
    );
  }
  const handles = bindings.pricingGroups.map((binding) => binding.marketHandle);
  if (new Set(handles).size !== handles.length) {
    throw new Error("Shopify Market handles must be unique.");
  }
  for (const buyer of new Set(
    plans.map((plan) => plan.assignment.businessUnitKey)
  )) {
    const contexts = plans.filter(
      (plan) => plan.assignment.businessUnitKey === buyer
    );
    if (
      new Set(
        contexts.map((plan) =>
          scopeKey(plan.pricingGroup.key, plan.priceList.currency)
        )
      ).size !== 1
    ) {
      throw new Error(
        `Company ${buyer} requires one pricing group and currency across its Store assignments`
      );
    }
  }
};

/** Local validation also runs for --plan, before product prerequisites can write. */
export const validateCompanyCatalogBindings = (
  bindings: CompanyCatalogBindings,
  plans: readonly CompanyCatalogPlan[]
) => {
  validateCompanyCatalogPolicies(bindings, plans);
  const buyers = new Set(plans.map((plan) => plan.assignment.businessUnitKey));
  const keys = bindings.companies.map(({ businessUnitKey }) => businessUnitKey);
  if (
    new Set(keys).size !== keys.length ||
    keys.length !== buyers.size ||
    [...buyers].some((key) => !keys.includes(key))
  ) {
    throw new Error(
      "Provide exactly one Shopify binding for every Business Unit in the source."
    );
  }
  const byCompany = new Map<string, Set<string>>();
  for (const binding of bindings.companies) {
    const selected = binding.companyLocationIds ?? ["*"];
    const previous = byCompany.get(binding.companyId) ?? new Set<string>();
    if (
      new Set(selected).size !== selected.length ||
      selected.some((id) => previous.has(id)) ||
      (previous.size > 0 && (previous.has("*") || selected.includes("*")))
    ) {
      throw new Error(
        "Shopify Business Unit mappings must select distinct company locations."
      );
    }
    for (const id of selected) {
      previous.add(id);
    }
    byCompany.set(binding.companyId, previous);
  }
};

/** Company Markets carry prices only. Public product availability belongs to the regional Markets. */
export const makeCompanyCatalogDestination = (
  settings: Effect.Effect<CatalogSettings, DestinationError>,
  bindings: Pick<CompanyCatalogBindings, "pricingGroups">,
  sourceCatalog: string,
  sellingKey: string,
  fetchApi: typeof fetch = globalThis.fetch
) => {
  const { request, mutation } = journalCatalogAdmin(
    makeCatalogAdmin(settings, fetchApi)
  );
  const decode = <A extends Schema.Top>(
    schema: A,
    raw: Schema.Json | undefined
  ) =>
    Schema.decodeUnknownEffect(schema)(raw).pipe(
      Effect.mapError(() =>
        fail("Shopify returned an invalid or incomplete B2B setup resource")
      )
    );
  const markets = Effect.gen(function* () {
    const found: { readonly id: string; readonly handle: string }[] = [];
    let after: string | null = null;
    const cursors = new Set<string>();
    while (true) {
      const raw: Record<string, Schema.Json> = yield* request(
        "companyMarkets",
        `query CompanyMarkets($after:String) { markets(first:50,after:$after) { nodes { id handle } pageInfo { hasNextPage endCursor } } }`,
        { after }
      );
      const page = yield* decode(
        Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({ handle: Schema.String, id: Schema.String })
          ),
          pageInfo: Schema.Struct({
            endCursor: Schema.NullOr(Schema.String),
            hasNextPage: Schema.Boolean,
          }),
        }),
        raw.markets
      );
      found.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) {
        return found;
      }
      after = page.pageInfo.endCursor;
      if (!after || cursors.has(after)) {
        return yield* fail("Invalid Shopify Markets pagination");
      }
      cursors.add(after);
    }
  });
  const readMarket = (id: string) =>
    request(
      "companyMarket",
      `query CompanyMarket($id:ID!) { market(id:$id) { ${marketFields} } }`,
      { id }
    ).pipe(Effect.flatMap((raw) => decode(MarketResource, raw.market)));
  const updateMarket = (id: string, input: Schema.Json) =>
    mutation(
      "marketUpdate",
      `mutation CompanyMarketUpdate($id:ID!,$input:MarketUpdateInput!) { marketUpdate(id:$id,input:$input) { market { id } userErrors { message } } }`,
      { id, input }
    );
  const catalogStatus = (id: string, status: "ACTIVE" | "DRAFT") =>
    mutation(
      "catalogUpdate",
      `mutation CompanyCatalogStatus($id:ID!,$input:CatalogUpdateInput!) { catalogUpdate(id:$id,input:$input) { catalog { id } userErrors { message } } }`,
      { id, input: { status } }
    );

  const readCompanyLocations = Effect.fn("ShopifyCompanyCatalog.readLocations")(
    function* (binding: CompanyLocationBinding) {
      const raw = yield* request(
        "companyCatalogTarget",
        `query CompanyCatalogTarget($id:ID!) { company(id:$id) { id locations(first:250) { nodes { id } pageInfo { hasNextPage } } } }`,
        { id: binding.companyId }
      );
      const company = yield* decode(
        Schema.Struct({
          id: Schema.String,
          locations: Connection(Resource),
        }),
        raw.company
      );
      if (
        company.id !== binding.companyId ||
        company.locations.pageInfo.hasNextPage
      ) {
        return yield* fail(
          "Company identity mismatch or more than 250 company locations"
        );
      }
      const selected = company.locations.nodes.filter(
        (location) =>
          !binding.companyLocationIds ||
          binding.companyLocationIds.includes(location.id)
      );
      if (
        !selected.length ||
        (binding.companyLocationIds &&
          (new Set(binding.companyLocationIds).size !==
            binding.companyLocationIds.length ||
            selected.length !== binding.companyLocationIds.length))
      ) {
        return yield* fail(
          "Every selected company location must belong to its explicitly bound company"
        );
      }
      // Keep nested connection reads below the Admin API's query-cost limit.
      for (const location of selected) {
        const rawLocation = yield* request(
          "companyLocationCatalogs",
          `query CompanyLocationCatalogs($id:ID!) { companyLocation(id:$id) { id catalogs(first:25) { nodes { id status } pageInfo { hasNextPage } } } }`,
          { id: location.id }
        );
        const target = yield* decode(
          Schema.Struct({
            catalogs: Connection(
              Schema.Struct({ id: Schema.String, status: Schema.String })
            ),
            id: Schema.String,
          }),
          rawLocation.companyLocation
        );
        if (
          target.id !== location.id ||
          target.catalogs.pageInfo.hasNextPage ||
          target.catalogs.nodes.some((catalog) => catalog.status === "ACTIVE")
        ) {
          return yield* fail(
            "Remove direct company-location Catalog assignments before using managed B2B Markets; they override Market pricing"
          );
        }
      }
      return selected.map((location) => location.id);
    }
  );
  const readProductVariants = Effect.fn(
    "ShopifyCompanyCatalog.readProductVariants"
  )(function* (
    product: {
      readonly key: string;
      readonly variants: readonly { readonly sku: string }[];
    },
    productId: string
  ) {
    const nativeVariants = new Map<string, string>();
    const raw = yield* request(
      "companyCatalogProduct",
      `query CompanyCatalogProduct($handle:String!) { product:productByIdentifier(identifier:{handle:$handle}) { id tags variants(first:250) { nodes { id sku } pageInfo { hasNextPage } } } }`,
      { handle: product.key }
    );
    const native = yield* decode(
      Schema.Struct({
        id: Schema.String,
        tags: Schema.Array(Schema.String),
        variants: Connection(
          Schema.Struct({
            id: Schema.String,
            sku: Schema.NullOr(Schema.String),
          })
        ),
      }),
      raw.product
    );
    if (
      native.id !== productId ||
      !native.tags.includes(`catalog-seed:${sourceCatalog}`) ||
      native.variants.pageInfo.hasNextPage ||
      native.variants.nodes.length !== product.variants.length
    ) {
      return yield* fail(`Foreign or incomplete source product ${product.key}`);
    }
    for (const variant of product.variants) {
      const matches = native.variants.nodes.filter(
        ({ sku }) => sku === variant.sku
      );
      if (
        matches.length !== 1 ||
        !matches[0] ||
        nativeVariants.has(variant.sku)
      ) {
        return yield* fail(`Ambiguous or missing SKU ${variant.sku}`);
      }
      nativeVariants.set(variant.sku, matches[0].id);
    }
    return Object.fromEntries(nativeVariants);
  });
  const resolveMarketTargets = Effect.fn(
    "ShopifyCompanyCatalog.resolveTargets"
  )(function* (
    plans: readonly CompanyCatalogPlan[],
    locations: ReadonlyMap<string, readonly string[]>
  ) {
    const existing = yield* markets;
    const desired = bindings.pricingGroups.map((binding) => ({
      binding,
      key: binding.pricingGroupKey,
      members: plans.filter(
        (plan) =>
          plan.pricingGroup.key === binding.pricingGroupKey &&
          plan.priceList.currency === binding.currency
      ),
    }));
    const handles = new Set(desired.map(({ binding }) => binding.marketHandle));
    const selectedLocations = new Set([...locations.values()].flat());
    for (const reference of existing.filter(
      ({ handle }) => !handles.has(handle)
    )) {
      const market = yield* readMarket(reference.id);
      const condition = market.conditions?.companyLocationsCondition;
      if (
        market.status !== "ACTIVE" ||
        !condition ||
        condition.applicationLevel === "ALL"
      ) {
        continue;
      }
      if (
        condition.companyLocations.pageInfo.hasNextPage ||
        market.catalogs.pageInfo.hasNextPage
      ) {
        return yield* fail(
          "An unconfigured B2B Market cannot be completely checked for overlapping company policies"
        );
      }
      if (
        market.catalogs.nodes.some((catalog) => catalog.status === "ACTIVE") &&
        condition.companyLocations.nodes.some(({ id }) =>
          selectedLocations.has(id)
        )
      ) {
        return yield* fail(
          "Another active company-location Market overlaps the managed pricing. Reconcile its configuration before importing."
        );
      }
    }
    // Read and validate every existing target before mutating any Market or Catalog.
    for (const desiredScope of desired) {
      const { binding, members } = desiredScope;
      const matches = existing.filter((market) =>
        binding.marketId
          ? market.id === binding.marketId
          : market.handle === binding.marketHandle
      );
      if (matches.length > 1 || (binding.marketId && matches.length !== 1)) {
        return yield* fail("Ambiguous or missing explicit B2B Market binding");
      }
      const [match] = matches;
      const current = match ? yield* readMarket(match.id) : undefined;
      if (current) {
        if (
          current.handle !== binding.marketHandle ||
          current.conditions?.conditionTypes.length !== 1 ||
          !current.conditions.companyLocationsCondition ||
          current.conditions.companyLocationsCondition.applicationLevel ===
            "ALL" ||
          current.conditions.companyLocationsCondition.companyLocations.pageInfo
            .hasNextPage ||
          current.catalogs.pageInfo.hasNextPage ||
          current.currencySettings?.baseCurrency.currencyCode !==
            binding.currency ||
          current.currencySettings.localCurrencies
        ) {
          return yield* fail(
            `Market ${binding.marketHandle} must use explicit company-location conditions and the declared fixed currency`
          );
        }
        if (current.catalogs.nodes.length > 1) {
          return yield* fail("Ambiguous managed Market Catalog");
        }
        const [catalog] = current.catalogs.nodes;
        if (
          catalog &&
          (catalog.publication ||
            (catalog.priceList &&
              catalog.priceList.currency !== binding.currency))
        ) {
          return yield* fail(
            "Managed Catalog type or currency differs from its declared policy"
          );
        }
      }
      const companyLocationIds = [
        ...new Set(
          members.flatMap(
            (plan) => locations.get(plan.assignment.businessUnitKey) ?? []
          )
        ),
      ];
      if (companyLocationIds.length > 250) {
        return yield* fail(
          "B2B Market reconciliation supports at most 250 explicitly selected company locations per policy"
        );
      }
    }
  });
  const ensureMarket = Effect.fn("ShopifyCompanyCatalog.ensureMarket")(
    function* (
      binding: PricingGroupBinding,
      companyLocationIds: readonly string[],
      trackedId: string | null | undefined
    ) {
      if (trackedId && binding.marketId && trackedId !== binding.marketId) {
        return yield* fail(
          "The Market binding differs from its tracking record"
        );
      }
      const id = trackedId ?? binding.marketId;
      if (id) {
        const market = yield* readMarket(id);
        if (market.handle !== binding.marketHandle) {
          return yield* fail(`Unexpected handle for Shopify Market ${id}`);
        }
        return id;
      }
      if (!companyLocationIds.length) {
        return null;
      }
      if (
        (yield* markets).some(({ handle }) => handle === binding.marketHandle)
      ) {
        return yield* fail(
          `Market ${binding.marketHandle} already exists without a tracking record`
        );
      }
      const result = yield* mutation(
        "marketCreate",
        `mutation CompanyMarketCreate($input:MarketCreateInput!) { marketCreate(input:$input) { market { ${marketFields} } userErrors { message } } }`,
        {
          input: {
            conditions: { companyLocationsCondition: { companyLocationIds } },
            currencySettings: {
              baseCurrency: binding.currency,
              localCurrencies: false,
            },
            handle: binding.marketHandle,
            name: binding.marketName,
            status: "DRAFT",
          },
        }
      );
      return (yield* decode(MarketResource, result.market)).id;
    }
  );
  const titleFor = (binding: PricingGroupBinding) =>
    `catalog-import/${sellingKey}/price/${binding.pricingGroupKey}/${binding.currency}`;
  const managedCatalog = Effect.fn("ShopifyCompanyCatalog.managedCatalog")(
    function* (
      binding: PricingGroupBinding,
      market: typeof MarketResource.Type
    ) {
      if (
        market.handle !== binding.marketHandle ||
        market.catalogs.pageInfo.hasNextPage ||
        market.catalogs.nodes.length > 1
      ) {
        return yield* fail(
          `Market ${binding.marketHandle} changed after preflight`
        );
      }
      const [catalog] = market.catalogs.nodes;
      if (
        catalog &&
        (catalog.publication ||
          (catalog.priceList &&
            catalog.priceList.currency !== binding.currency))
      ) {
        return yield* fail(
          `Foreign or incompatible Catalog in Market ${binding.marketHandle}`
        );
      }
      return catalog;
    }
  );
  const readCatalog = (binding: PricingGroupBinding, marketId: string) =>
    readMarket(marketId).pipe(
      Effect.flatMap((market) => managedCatalog(binding, market))
    );
  const draftCatalog = Effect.fn("ShopifyCompanyCatalog.draftCatalog")(
    function* (
      binding: PricingGroupBinding,
      marketId: string,
      desiredLocations: readonly string[],
      trackedId: string | null | undefined
    ) {
      const market = yield* readMarket(marketId);
      const catalog = yield* managedCatalog(binding, market);
      if ((catalog?.id ?? null) !== (trackedId ?? null)) {
        return yield* fail(
          `Catalog in Market ${binding.marketHandle} differs from its tracking record`
        );
      }
      const condition = market.conditions?.companyLocationsCondition;
      if (!condition || condition.companyLocations.pageInfo.hasNextPage) {
        return yield* fail(
          `Cannot verify membership of Market ${binding.marketHandle}`
        );
      }
      const currentLocations = condition.companyLocations.nodes;
      const moving =
        desiredLocations.length !== currentLocations.length ||
        currentLocations.some(({ id }) => !desiredLocations.includes(id));
      if (catalog) {
        if (moving && catalog.status !== "DRAFT") {
          yield* catalogStatus(catalog.id, "DRAFT");
        }
        return catalog.id;
      }
      if (desiredLocations.length === 0) {
        return null;
      }
      const result = yield* mutation(
        "catalogCreate",
        `mutation CompanyCatalogCreate($input:CatalogCreateInput!) { catalogCreate(input:$input) { catalog { ${catalogFields} } userErrors { message } } }`,
        {
          input: {
            context: { marketIds: [marketId] },
            status: "DRAFT",
            title: titleFor(binding),
          },
        }
      );
      return (yield* decode(CatalogResource, result.catalog)).id;
    }
  );
  const ensurePriceList = Effect.fn("ShopifyCompanyCatalog.ensurePriceList")(
    function* (
      binding: PricingGroupBinding,
      marketId: string,
      catalogId: string,
      trackedId: string | null | undefined
    ) {
      const catalog = yield* readCatalog(binding, marketId);
      if (!catalog || catalog.id !== catalogId) {
        return yield* fail(
          `Tracked Shopify Catalog changed in ${binding.marketHandle}`
        );
      }
      if ((catalog.priceList?.id ?? null) !== (trackedId ?? null)) {
        return yield* fail(
          `Price List in Market ${binding.marketHandle} differs from its tracking record`
        );
      }
      if (catalog.priceList) {
        return catalog.priceList.id;
      }
      const result = yield* mutation(
        "priceListCreate",
        `mutation CompanyPriceListCreate($input:PriceListCreateInput!) { priceListCreate(input:$input) { priceList { id } userErrors { message } } }`,
        {
          input: {
            catalogId,
            currency: binding.currency,
            name: titleFor(binding),
            parent: { adjustment: { type: "PERCENTAGE_DECREASE", value: 0 } },
          },
        }
      );
      return (yield* decode(Resource, result.priceList)).id;
    }
  );
  const setFixedPrice = (
    priceListId: string,
    variantId: string,
    centAmount: number,
    currencyCode: string
  ) =>
    mutation(
      "priceListFixedPricesAdd",
      `mutation CompanyFixedPrices($id:ID!,$prices:[PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId:$id,prices:$prices) { userErrors { message } } }`,
      {
        id: priceListId,
        prices: [
          {
            price: {
              amount: shopifyMoney({ centAmount, currencyCode }),
              currencyCode,
            },
            variantId,
          },
        ],
      }
    ).pipe(Effect.asVoid);
  const updateMembership = Effect.fn("ShopifyCompanyCatalog.updateMembership")(
    function* (
      binding: PricingGroupBinding,
      marketId: string,
      companyLocationIds: readonly string[]
    ) {
      const current = yield* readMarket(marketId);
      const condition = current.conditions?.companyLocationsCondition;
      if (
        current.handle !== binding.marketHandle ||
        current.conditions?.conditionTypes.length !== 1 ||
        !condition ||
        condition.applicationLevel === "ALL" ||
        condition.companyLocations.pageInfo.hasNextPage ||
        current.currencySettings?.baseCurrency.currencyCode !==
          binding.currency ||
        current.currencySettings.localCurrencies
      ) {
        return yield* fail(
          `Market ${binding.marketHandle} changed after preflight`
        );
      }
      if (companyLocationIds.length === 0) {
        if (current.status !== "DRAFT") {
          yield* updateMarket(marketId, { status: "DRAFT" });
        }
        return;
      }
      const oldIds = condition.companyLocations.nodes.map(({ id }) => id);
      const add = companyLocationIds.filter((id) => !oldIds.includes(id));
      const remove = oldIds.filter((id) => !companyLocationIds.includes(id));
      const input: CompanyMarketActivation = {
        name: binding.marketName,
        status: "ACTIVE",
      };
      if (add.length || remove.length) {
        input.conditions = {};
        if (add.length) {
          input.conditions.conditionsToAdd = {
            companyLocationsCondition: { companyLocationIds: add },
          };
        }
        if (remove.length) {
          input.conditions.conditionsToDelete = {
            companyLocationsCondition: { companyLocationIds: remove },
          };
        }
      }
      yield* updateMarket(marketId, input);
    }
  );
  const activateCatalog = Effect.fn("ShopifyCompanyCatalog.activateCatalog")(
    function* (
      binding: PricingGroupBinding,
      marketId: string,
      catalogId: string,
      priceListId: string
    ) {
      const catalog = yield* readCatalog(binding, marketId);
      if (
        !catalog ||
        catalog.id !== catalogId ||
        catalog.priceList?.id !== priceListId
      ) {
        return yield* fail(
          `Tracked Shopify Catalog or Price List changed in ${binding.marketHandle}`
        );
      }
      if (catalog.status !== "ACTIVE") {
        yield* catalogStatus(catalog.id, "ACTIVE");
      }
    }
  );
  return {
    activateCatalog,
    draftCatalog,
    ensureMarket,
    ensurePriceList,
    preflight: resolveMarketTargets,
    readCompanyLocations,
    readProductVariants,
    setFixedPrice,
    updateMembership,
  };
};

export type CompanyCatalogDestination = ReturnType<
  typeof makeCompanyCatalogDestination
>;
