# Initial catalogs

These provider-owned Migrate SDK definitions read the shared domain JSON from `commerce-core/catalog/` and import two independent starter datasets into Shopify. Commercetools reads the same source files through its own mapping. Select a group explicitly:

| Group | Products | Variants | Collection |
| --- | --- | --- | --- |
| `b2b` | Compact excavator, mobile lift, pallet truck, replacement attachment | 6 | `equipment-catalog` |
| `b2c` | Trail jacket, hiking shirt, daypack, insulated bottle | 10 | `outdoor-catalog` |

Both datasets include a discounted price and a sold-out variant. They exercise native variant options, typed product attributes, a variant override and related-product references. They contain English/French content, categories, stock and AI-generated studio photos matched to the product's model or color. Start with separate development shops for separate B2B and B2C assemblies. Collections organize products; they do not restrict buyer access. The base B2B product-import group supplies equipment content; company prices are provisioned by the separate `b2b-companies` migration graph and consumed by the B2B frontend recipe.

## Configure an import target

Copy `.env.example` to `.env` in this directory. Configuration is loaded from this package-local file; existing shell environment values take precedence. The importer is pinned to Admin API `2026-10` and these fixtures use USD. It checks that every base product price matches the shop currency and verifies the publication and locale configuration before creating definitions. Only inventory items require an active location. Custom source catalogs can use the shop's configured base currency; money is encoded at that currency's native minor-unit precision. The shop primary locale must match the catalog default locale. The shared `shopify-locales` migration enables and publishes declared translation languages, including French for both starter catalogs. It validates the native locale mapping and preserves the primary language and unrelated languages. Publish an externally enabled language in Shopify before importing its translations.

Markets and currency settings can be configured before importing through the provider's `commerce project provision` command; see the [provider setup guide](../README.md#setup). That command reads the Stores declared in Commerce Core and the explicit Store-to-Market bindings in `../store.ts`. It needs additional `read_markets`/`write_markets` Admin scopes; it does not infer Markets from locales or catalog prices. It does not change the shop's base currency or run this import.

Set `SHOPIFY_ADMIN_CLIENT_ID` and `SHOPIFY_ADMIN_CLIENT_SECRET` for the installed Admin app; the importer exchanges them for a token on demand and caches it until before expiry. Use an app with product, inventory, location and publication access: `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_locations`, `read_publications`, `write_publications`, `read_files`, `write_files`, `read_translations`, `write_translations`, `read_locales`, `write_locales`. The app and shop must satisfy Shopify's client-credentials requirements described in the [Admin credentials guide](../README.md#runtime-admin-credentials). Alternatively supply a separately managed Admin token in `SHOPIFY_ADMIN_ACCESS_TOKEN` and omit the client secret. Never put the client secret in the access-token variable. Use the Headless storefront's publication ID and the inventory location that will fulfill test orders. Admin credentials are separate from Storefront and Customer Account credentials.

The CLI can plan and list definitions without credentials. Composition installs the files; it never executes the import.

Catalog prerequisites also provision the `commerce.store_key` Order metafield definition used by hosted checkout. Grant `read_orders` and `write_orders` to the provisioning app in addition to the catalog scopes above. The definition enables native cart-to-order copying and Admin filtering; both B2C and B2B imports install it. It is independent of the product attribute model and does not create orders or assign company pricing groups. See [Store attribution](../README.md#cart-and-checkout).

Before testing the imported catalog, follow the provider's [Headless Storefront permission setup](../README.md#setup). In particular, enable `unauthenticated_read_product_inventory` on the storefront that issued the web app's private token. The Admin import scopes above do not grant that access. The final import stages publish products, the grouping collection and category collections to `SHOPIFY_CATALOG_PUBLICATION_ID`; that ID must belong to the same Headless storefront.

## Run from the workspace root

```sh
pnpm --filter @repo/commerce-shopify catalog run --group b2c --with-dependencies --plan
pnpm --filter @repo/commerce-shopify catalog run --group b2c --with-dependencies
pnpm --filter @repo/commerce-shopify catalog status --group b2c
pnpm --filter @repo/commerce-shopify catalog messages --group b2c
```

For the equipment catalog, substitute `--group b2b`. The same commands work in a composed customer workspace. Review all item errors after execution. A plan displays dependency order; it does not execute the mapping or validate remote permissions.

The shared `project-setup` group owns shop locales, metafield definitions, and Order attribution. Catalog groups include those prerequisites with `--with-dependencies`. Each catalog has separate migrations for Files, Products, category collections, and the grouping collection. Category membership, product references, translations, and grouping-collection membership have one item per owning Product. Inventory and variant galleries have one item per SKU. Product publication waits for its content, references, translations, galleries, and collection assignments. Inventory runs independently. Shopify's synchronous Product write includes native options and variants and attaches tracked Files.

Declare `shipping.file` and `shipping.profile` in `migrate.config.ts` to add Delivery Profile, Zone, and Shipping Method migrations to `project-setup`. The Profile migration creates its initial fulfillment location group and records both native IDs. Zones and Methods consume those tracking records. See the [shipping config example](../../commerce-core/provisioning/README.md#shared-shipping-setup).

Keep one migration state directory for the chosen setup entry point and shop. The standalone import scopes the store by shop domain. Publication and inventory location affect the versions of the items that write to those targets. Acknowledged mutations go into the issuing item's journal, including entries from attempts that later fail.

The document source reads the schema-validated catalog during discovery and retry. For a fresh import, use an empty destination for the resources the migration creates and a fresh state directory.

## Reruns and recovery

Normal runs skip unchanged successful items and retry eligible failures. Run the same group again after a transient failure, or select failed items explicitly:

```sh
pnpm --filter @repo/commerce-shopify catalog run --group b2c --with-dependencies --failed
```

Edit `commerce-core/catalog/b2b.json` or `commerce-core/catalog/b2c.json` to change the source data. See the [domain catalog format](../../commerce-core/catalog/README.md). Product handles and SKUs are stable source keys. The Product migration updates its tracked native ID and keeps the native variant IDs for existing SKUs. It preserves other metafields and tags. Existing untracked Products and Collections fail ownership validation. An interrupted collection assignment or stock write can be retried against the tracked IDs. Stock updates use Shopify's idempotency directive and compare-and-swap.

The inventory item reconciles the fixture quantity for its SKU. A title, price or image edit leaves the inventory item unchanged. The first run after splitting the migration, an explicit inventory update, or a retry of a failed inventory item can reapply fixture stock quantities.

Use an explicit update to rerun the mapping for tracked resources. Resolve a missing tracked resource or an unconfirmed create before rerunning.

```sh
pnpm --filter @repo/commerce-shopify catalog run --group b2c --with-dependencies --update
```

The definitions do not implement automatic rollback or orphan deletion. Removing a fixture does not delete an existing Shopify product. Keep the saved state when diagnosing failures. Migrate SDK's `--limit` applies independently to each definition; use a complete prerequisite run before running a dependent stage that needs all related products.

## Attribute mapping

Core's generated schemas remain the authority for the domain model. Equipment uses the existing equipment types; `outdoor-product` adds typed material, weight in grams, volume in milliliters, care and insulation. Its schema is declared in Core’s provider-neutral `catalog/product-model.json`, alongside the equipment types. Core generates the application schemas; this provider derives its metafield definitions, codecs and queried identifiers from that same model. Commercetools imports these same domain files using its own catalog definitions.

The `commerce.productType` product metafield selects the Core schema. Products without it retain generic behavior; an unknown declared type fails. Descriptive attributes use individual typed `commerce` metafields with Storefront `PUBLIC_READ` definitions. Variant values override product defaults. Equipment Model/Color and outdoor Size/Color retain their stable keys in those metafields. The importer assigns explicit native option positions and joins imported variant SKUs with Admin `selectedOptions.optionValue.id` to record domain key → native option/value ID bindings in the public provider-owned `commerce_shopify.optionBindings` JSON metafield. The Storefront query fetches native option IDs and their names under `@inContext(language: ...)`. The reader joins by IDs and uses those returned strings for selection names, values and selected enum labels. It does not infer keys from translated text or rebuild option translations from Core. Core option keys remain canonical across both providers. Core regular/discounted minor-unit prices map to Shopify price and compare-at price. Source attributes are variant-owned; the runtime also accepts product defaults. Related product keys in the source become Shopify product IDs after product import. Source data and final Storefront projections are validated against Core.

Native options supply shared product selection and compact cart summaries; Shopify's synthetic `Title: Default Title` option is hidden. Core shopping UI is unchanged. Importing a descriptive attribute does not automatically add a new specification display to the product page.

## Verification

Tests run both groups through the real Migrate SDK with an in-memory store and test dependency order, ID references, retries and unchanged-item skipping. Shopify destination tests use controlled Admin responses, and product tests round-trip both datasets through the Storefront mapping. Remote provisioning and checkout still require the configured Shopify development shop.

References: [Migrate SDK CLI](https://migrate-sdk.dev/docs/operate/cli), [Shopify productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet), [Storefront metafields](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/metafields), [inventory idempotency](https://shopify.dev/docs/api/usage/idempotent-requests).

## Images, categories and translations

The File migration creates one Shopify File per product key and source image URL and records the returned ID. A filename collision fails the create. The Product migration checks readiness by tracked File ID up to six times at two-second intervals. Products attach those IDs as their files and select the first image as each variant's primary image. Gallery items consume the same File records in source order. Publication waits for those items to finish.

Image source URLs must have an explicit filename extension that Shopify can match to the uploaded filename. For example, use `https://placehold.co/1200x1200.png?text=Product`, not the extensionless `/1200x1200/png` endpoint. The importer preserves the source extension and rejects extensionless sources instead of assuming PNG.

The ordered complete gallery is written to `commerce.variantImages`, a public `list.file_reference` variant metafield, because Shopify's native variant image is singular. The Storefront query resolves those references into Core's existing `images` array. Empty source galleries clear the managed reference list. Updating a seeded product replaces its associated source files; unused file-library resources are not deleted.

Category keys become separately owned manual collections. The category-membership migration adds missing assignments from the source. Existing collection memberships are preserved even when an assignment is omitted from a later catalog file. Public collection markers distinguish those categories from the dataset's grouping collection in Core Product Detail. This is merchandising categorization, not Shopify's standard product taxonomy. Category hierarchies are not modeled. Collection pages exceeding 250 memberships and gallery reference pages exceeding 250 entries fail explicitly rather than truncating the domain projection.

Product/category translations use `translatableResource` digests followed by `translationsRegister`. The product translation migration also reads native Product Option and Product Option Value IDs and registers their name translations from the Product Model's attribute labels and enum labels. Only enum choices present on that product are imported. Numeric/text option values keep their original content; arbitrary attribute text and image alt text are not translated by this mapping.

The catalog's languages are its default locale plus the translation locales used by any of its products or categories. These languages drive native locale provisioning before product and category translations; `--plan` only displays migration order and makes no locale requests or changes. Option translations are imported for those languages when supplied by the model; other model languages do not require enabling extra shop languages. The bundled catalogs reuse the primary English copy for Canadian English. When both French variants are present, the importer uses Canadian French for workspaces with `fr-CA` enabled and France French otherwise. Custom catalogs supply their own translation variants. Missing model labels retain the base-language display. Attribute keys and enum keys are never translated. Metafield definition names use the model's default language; translated domain display labels remain in Core.

Locale resolution prefers an enabled exact locale and then its language code (`fr-FR` to `fr`). Distinct regional labels mapping to the same Shopify locale are rejected; Market-specific translations need a separate strategy. Preflight validates the primary language and locale mappings. Missing option resources or digests and rejected translations fail the translation item and block Product publication. Retrying uses the existing option resources. Supplied translations are upserted; removing a locale from JSON does not delete existing translations. Storefront queries use the selected language context. Native names may be edited or translations retained in Shopify without changing the stored domain keys or making their identity ambiguous.

The migration source revision includes the Product Model and catalog languages, so editing model labels or adding a catalog language reprocesses products in the selected group. Version 4 reprocesses earlier records to install native ID bindings and option translations. Rerun the import before reading typed products created by an earlier importer; a missing or stale binding fails explicitly rather than guessing from labels. Review the inventory items in the plan before running against a shop used for purchases.

References: [product files](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/FileSetInput), [translation registration](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/translationsRegister), [translatable option resources](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/TranslatableResourceType).

The starter Admin preservation read is bounded to 20 variants, 20 metafields per owner and 100 collection memberships. Larger resources fail before reconciliation rather than losing unread fields. These bounds keep nested reads small under Shopify's [single-query cost limit](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits); larger catalogs need a paginated or bulk import path.

## Custom models and sources

See the [agent authoring workflow](../../commerce-core/catalog/README.md#agent-authored-product-models-and-catalogs) for model JSON, validation, code generation and declaring project-owned data in `migrate.config.ts`. Custom source groups use `catalog-NAME` as their grouping collection handle. Product Types and attributes are read from the installed model; attribute reads use typed GraphQL identifier variables instead of a fixed field list. Custom product-reference attributes resolve after all product imports.

## Company assortments and fixed prices

The [company import guide](../../commerce-b2b/catalog/README.md) describes Core products, selling configuration and Business Unit assignments. The starter `b2b.migrate.config.ts` declares those files and expects `b2b-bindings.json` beside it. Copy `b2b-bindings.example.json` there and replace its Company ID placeholders. Company locations and customer-contact memberships must already exist. The importer expands each bound Company into all its locations by default. Set `companyLocationIds` to restrict a binding to selected locations owned by that Company.

```sh
pnpm --filter @repo/commerce-shopify catalog:b2b run --all --plan
pnpm --filter @repo/commerce-shopify catalog:b2b run --all
```

The standalone CLI and full setup use the same provider-owned company migration graph. The standalone company group selects source publication and inventory as separate branches. Company pricing resolves one location binding per Business Unit and one variant map per source Product. Market, Catalog, Price List, Market membership and Catalog activation each have one item per pricing group and currency. Fixed prices have one item per pricing group, currency and SKU.

Before moving locations, the graph drafts the pricing Catalogs whose Market membership will change. Fixed-price-only updates leave active Catalogs in place. Activation waits for the membership items and their price prerequisites to succeed. If a write fails, rerun the group to resume the failed items and the work waiting on them. Plan validates local inputs and displays the dependency graph without contacting Shopify.

Each company references one Company Pricing Group. Setup creates a company-location B2B Market with a pricing-only Catalog/PriceList per group/currency. It creates no company product publication. Shopify resolves company prices while public products remain governed by the regional Market and Headless sales-channel publications. Existing regional publication-only catalogs remain independent of company pricing.

The Admin token needs product import access, `read_companies`, `read_markets`, `write_markets` and publication management. The shop must have native Companies, the new B2B Markets functionality, and the assumed Plus capabilities. The importer does not activate plan features, configure shipping/payment gateways, or create company contacts.

An explicit `marketId` binds an existing Market. Otherwise the Market migration creates the declared Market and fails if its handle is already taken. Catalog and Price List ownership each comes from that resource's own tracking record. A matching Catalog title or an attached Price List without that record stops the run. Fixed prices use tracked Price List and Product variant IDs.

Before writing, setup checks company/location ownership, existing Market conditions and currency, and separately managed Catalogs. A fixed-price item checks the tracked variants of its own Product. Direct active company-location Catalogs are rejected because they outrank Market prices. The importer reconciles location additions and removals, including newly created locations when binding the whole Company. Configured pricing groups without assigned companies are made draft; omitted bindings do not trigger resource cleanup.

Fixed price input covers the public Store assortment, with a separate tracked write per SKU and pricing scope. Source products support 250 fully read variants and managed Markets support 250 fully read locations; truncated reads fail. Company setup does not change product publication. Keep existing regional Market catalog configuration for market-specific availability.

The frontend B2B recipe now queries verified company-location context for product discovery, cart and hosted checkout. Use the B2B recipe rather than the guest recipe for company shopping. [Frontend setup](../README.md#company-purchasing-and-b2b-markets).

Native references: [Market creation](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/marketCreate), [Market condition updates](https://shopify.dev/docs/api/admin-graphql/2026-10/input-objects/MarketConditionsUpdateInput), [independent pricing and assortments](https://shopify.dev/docs/apps/build/markets/catalogs-different-markets#two-catalog-pattern-for-scale), [headless company buyers](https://shopify.dev/docs/storefronts/headless/bring-your-own-stack/b2b).
