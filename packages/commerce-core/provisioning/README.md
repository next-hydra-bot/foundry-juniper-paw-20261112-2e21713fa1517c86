# Domain data provisioning

Provisioning uses the same domain definitions as application code. JSON is an input transport, Migrate SDK owns migration execution, and provider packages own native reads and writes. There is no separate migration entity model or new package.

## Ownership and inputs

| Concept | Owner | Creation or source input | Entity |
| --- | --- | --- | --- |
| Auth User | Auth Contract | `AuthUserInput` | Existing `AuthUser` fields, plus a provisioning key in `ProvisionedAuthUser` |
| Permission Grant | Auth Contract | `PermissionGrantInput` references user/resource keys | Existing `PermissionGrant` with resolved Auth User ID and Scope ID |
| Customer | Commerce Core | `CustomerInput` requires key/email; names are optional | `Customer` has a Customer ID; authenticated `CommerceCustomer` reuses its fields |
| Customer Identity Link | Commerce Core | `CustomerIdentityLinkInput` references Auth User and Customer keys | `CustomerIdentityLink` contains the resolved IDs |
| Catalog Price List | Commerce Core | `CatalogPriceListInput` | `CatalogPriceList` adds an opaque ID |
| Company Pricing Group | Commerce Core | `CompanyPricingGroupInput` | `CompanyPricingGroup` adds an opaque ID |
| Assortment | Commerce Core | `AssortmentInput` | `Assortment` adds an opaque ID |
| Business Unit | Commerce B2B | `BusinessUnitInput`; `BusinessUnitSourceInput` substitutes a parent key for its ID | `BusinessUnit` adds its ID |
| Business Unit Membership | Commerce B2B | Source references Customer/Business Unit keys; domain input uses IDs | `BusinessUnitMembership` is identified by those two IDs |
| Business Unit Catalog Assignment | Commerce B2B | Source references a Business Unit key; domain input uses its ID | Assignment retains the shared Store, locale, Assortment and Company Pricing Group fields |

An entity does not need an extra surrogate ID when its relationship already supplies its identity. B2C uses the shared Customer model and customer setup loader. It has no Business Unit or membership input models. B2B adds its input schemas to the CLI through the existing recipe/template mechanism. Neither Commerce Core nor the CLI imports Commerce B2B to discover these additions.

IDs are opaque domain types. Their values still belong to the destination that issued them; copying a Shopify ID into a commercetools request cannot identify the same entity. Owner-assigned keys connect source files across providers. Destination-specific ID formats and constraints stay in provider mappings. Unsupported native constraints must fail explicitly rather than changing a source key silently.

## Independent JSON files

Every file contains an array of records. Example customer input:

```json
[
  {
    "key": "outdoor-shopper",
    "email": "shopper@example.com",
    "firstName": "Alex",
    "lastName": "Morgan"
  }
]
```

Starter customer/identity files are owned by `commerce-b2c/provisioning/`. B2B owns its additional files under `commerce-b2b/provisioning/`: `auth-users.json`, `customers.json`, `customer-identity-links.json`, `business-units.json`, `business-unit-memberships.json`. Membership rows declare the role keys to assign in their Business Unit. Replace example addresses before live sign-in. Existing product, selling and company-catalog assignment files remain authoritative; the new fixtures do not duplicate their price lists or assignments.

`loadCustomerProvisioningInputs(directory)` validates the common identity/customer references. `loadBusinessUnitProvisioningInputs(directory, availableStoreKeys)` extends that validation with memberships, declared Store keys and parent-before-child ordering. It rejects hierarchy cycles, unknown references and duplicate relationships. These loaders perform no destination writes and do not establish identity ownership.

Admin provisioning uses a separate auth application, source set and execution namespace. The presence of a Permission Grant input schema never authorizes an application action. The setup grant destinations use storefront user metadata. They do not create auth Organizations or provision native Admin permissions.

## Shared shipping setup

`shipping.example.json` defines a small sandbox configuration for both commerce providers. A Shipping Zone groups whole destination countries. A Shipping Service offers one fixed price per served Zone. Prices use integer minor units. Countries appear in at most one Zone and service keys and names are unique. Province rules, delivery promises, conditional prices, carrier calculations, and pickup remain provider configuration.

Copy the example to `data/shipping.json` in the package where you run migrations. Keep the input and state paths in that package's developer-owned `migrate.config.ts`. For a shipping-only commercetools run, use `packages/commerce-commercetools` and this configuration.

```ts
import { defineCatalogMigrationConfig } from "@repo/commerce-commercetools/catalog/migrate";

export default await defineCatalogMigrationConfig({
  catalogs: {},
  stateDirectory: new URL(".migrate/", import.meta.url),
  shipping: {
    file: new URL("data/shipping.json", import.meta.url),
    taxCategoryKey: "standard",
  },
});
```

The commercetools Zone migration creates one native Zone per source key. The Shipping Method migration creates one native method per service with a flat rate for each declared Zone. Each rate references the native Zone ID from that Zone's successful tracking record. Provision the Tax Category first and supply its native key as `taxCategoryKey`. Use the project-qualified `manage_zones` and `manage_shipping_methods` scopes. [Create Zone](https://docs.commercetools.com/api/projects/zones#create-zone) · [Create Shipping Method](https://docs.commercetools.com/api/projects/shippingMethods#create-shippingmethod)

For Shopify, use `packages/commerce-shopify` and declare the Delivery Profile in the same config. Supply the existing fulfillment Location ID. The profile key identifies its source record and the name is a display value.

```ts
import { defineCatalogMigrationConfig } from "@repo/commerce-shopify/catalog/migrate";

export default await defineCatalogMigrationConfig({
  catalogs: {},
  stateDirectory: new URL(".migrate/", import.meta.url),
  shipping: {
    file: new URL("data/shipping.json", import.meta.url),
    profile: {
      key: "sandbox-shipping",
      locationId: "gid://shopify/Location/123",
      name: "Sandbox shipping",
    },
  },
});
```

The `shopify-delivery-profiles` migration creates an app-owned Delivery Profile with `coversAllItems: true` and its initial location group in one native mutation. It journals the acknowledged create, verifies the returned fulfillment Location, and records the native profile and group IDs together. The installed app needs shipping write access and the destination countries must be eligible in Shopify Markets. On legacy shops, an applicable merchant rate can take precedence when the profiles share a location. [Delivery profile creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/deliveryProfileCreate) · [Shopify shipping rollout](https://shopify.dev/docs/apps/build/orders-fulfillment/market-driven-shipping/upgrade-your-app)

Shopify's Zone migration depends on the Delivery Profile migration and uses its recorded IDs. Its Shipping Method migration owns one native method per service and Zone, keyed by the pair of source keys, and uses the Zone's tracking record. Shopify returns the parent Delivery Profile when a nested create succeeds. The migration verifies the scope against its tracking records and records the one new child ID from the mutation response. Keep previously applied rows in the source so this check can account for their IDs when you add rows. This setup supports ten Zones per group and twenty methods per Zone. [Delivery profile update](https://shopify.dev/docs/api/admin-graphql/latest/mutations/deliveryProfileUpdate)

Run these commands from the package containing `migrate.config.ts`.

```sh
pnpm exec migrate run --group project-setup --plan
pnpm exec migrate run --group project-setup
```

Each item journals its acknowledged write and saves the returned native ID in its Migrate SDK tracking record. Migrate SDK skips unchanged successful items. Names are display values. Keep source keys and the state directory stable when adding rows. The setup migrations are create-only and reject changes to already tracked items. Add update behavior to the migration that owns the item and target the ID in its tracking record.

The Delivery Profile migration resolves credentials before reserving its create. The bundled SDK patch adds `Tracking.checkpoint`, which persists the item's journal without publishing a successful tracking record. The migration checkpoints its reservation before submitting the request and checkpoints acknowledged creation IDs before validating the result. If the process terminates before settlement, the saved reservation blocks another create.

If Shopify confirms a rejection, such as a validation error or a throttle before execution, the migration clears its reservation and checkpoints that change so you can correct the cause and rerun. If the outcome is unconfirmed, the item fails without a successful tracking record and subsequent attempts stop before sending the same write. Inspect the bound profile and the item journal. A fresh setup uses an empty destination scope and fresh migration state together. Keep manual provider configuration for shipping rules outside the shared model.

## Schema and customer command

Both commerce providers expose the same customer provisioning command:

```sh
pnpm --filter cli cli commerce data schema customers --output "$PWD/customers.schema.json"
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce data provision --input "$PWD/packages/commerce-b2c/provisioning/customers.json" --plan
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce data provision --input "$PWD/packages/commerce-b2c/provisioning/customers.json"
```

`schema` also accepts `auth-users`, `permission-grants`, `customer-identity-links`, `price-lists`, `pricing-groups`, `assortments` and `catalog-assignments`. Selecting Commerce B2B contributes `business-units`, `business-unit-memberships` and `business-unit-catalog-assignments`. Schema generation does not load credentials. These are JSON schemas for arrays, derived from the input codecs rather than hand-maintained copies; agents can use them to generate individual files. Cross-file references still need the profile validator.

The Permission Grant schema derives its allowed permission names from the composed storefront manifest. Admin can use the same schema factory with its own manifest and separate source files; Admin permissions never enter the storefront schema.

The current `data provision` command executes the **customer group only**. It does not create auth users, memberships, identity links or grants. `--plan` validates input and displays execution order without reading or writing native resources; it is not a remote change preview. Plans need a destination identity but not credentials. Shopify uses `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_CLIENT_ID` and `SHOPIFY_ADMIN_CLIENT_SECRET` to acquire and cache an Admin token with customer read/write access. A separately managed `SHOPIFY_ADMIN_ACCESS_TOKEN` is also supported without a client secret. Commercetools uses the standard project/region/client credentials and a scope permitting customer management; runtime checkout scopes are not required just to seed Customers.

The SDK store is scoped by the provider, destination identity and migration definition under `--state-directory` (default `.migrate`). It contains no access tokens. Group execution waits for the SDK's terminal result and returns failure when any item fails. Unchanged successful inputs are skipped. The document source reads the JSON files again during discovery and retry, and derives versions from the selected payload and its mapping inputs. When a destination is invoked again, it reconciles native state.

When repopulating a wiped destination, pass a fresh `--state-directory` so the run starts with empty tracking state.

The Shopify destination updates the Customer ID from its own tracking record. On creates it uses the technical source-key tag to detect collisions. It preserves unrelated tags during updates. The commercetools destination uses its native key and versioned profile updates, retaining existing authentication settings. New profiles use `ExternalAuth` without passwords. Neither destination fabricates Shopify sessions or private identity associations; the existing verified registration/SSO flow establishes the identity link.

## Migrate SDK composition

Inside a provider-owned assembly, the migration uses the domain input directly:

```ts
const customers =
  yield *
  makeJsonMigration({
    id: "customers",
    group: "provision",
    input: {
      schema: CustomerInput,
      read: readSourceFile(readJsonInputs(CustomerInput, customerFile)),
      key: (input) => input.key,
    },
    destination: customerDestination,
    store: targetStore,
    revision: "customer-mapping-v1",
  });
const registry = MigrationDefinitionRegistry.make({ definitions: [customers] });
yield * provisionMigrationGroup(registry, "provision");
```

`customerDestination` comes from the selected commerce package and `targetStore` from the provider-owned execution namespace. The destination accepts the decoded `CustomerInput` and returns `Customer`. `Schema.toCodecJson` derives the JSON representation for brands and Redacted values. The SDK source encodes that representation for versioning, then decodes it back to domain inputs. Destination results are validated against the domain entity schema before their minimal ID/key references are tracked.

Later definitions declare required dependencies and use `references.get(definition, sourceKey)` to resolve one migrated resource. Resolution requires a successfully migrated tracking record. Revisions must include relevant source-dependency changes as well as mapping changes. The profile must validate all files before group execution begins.

## Complete setup command

Both providers expose one `commerce data setup` command. The selected recipe chooses the B2B profile or the common B2C profile; the selected auth provider supplies the Auth User and storefront metadata destinations. Application code only provides these package-owned layers.

Run from the composed workspace root with absolute input paths:

```sh
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce data setup --directory "$PWD/packages/commerce-b2c/provisioning" --state-directory "$PWD/.migrate" --plan
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce data setup --directory "$PWD/packages/commerce-b2b/provisioning" --bindings "$PWD/packages/commerce-shopify/provisioning/catalog-bindings.example.json" --state-directory "$PWD/.migrate" --plan
```

For commercetools B2B, use `packages/commerce-commercetools/provisioning/catalog-bindings.example.json`. Remove `--plan` to execute. The older `data provision --input` command remains a customer-only import. Use complete setup to provision the Business Unit hierarchy and its catalog assignments together. Keep one setup entry point and state directory for any overlapping Shopify resources. Paths passed to the CLI resolve from the CLI app's working directory, so root examples use absolute paths.

Each profile has a `setup.json` pointing to its catalog and, for B2B, the existing selling and assignment files. Paths inside that JSON resolve from the profile directory:

```json
{
  "catalogFile": "../../commerce-core/catalog/b2b.json",
  "catalogName": "b2b",
  "sellingFile": "../../commerce-core/catalog/b2b-selling.json",
  "assignmentsFile": "../catalog/assignments.json"
}
```

The selected catalog is imported with its existing product-model, category, product, translation and publication migrations. Price Lists, Company Pricing Groups and Assortments continue to come from the shared schemas in the selling source. Provider bindings specify native Market or channel configuration separately; Shopify company/location IDs are resolved from the Business Unit migrations, not entered into bindings by hand.

Custom profiles can keep pricing entities in independent arrays. Add `priceListsFile`, `pricingGroupsFile` and `assortmentsFile` to `setup.json`; supply all three together. In this form, `sellingFile` contains only `key`, `sourceCatalog` and the explicit `stores` configuration. Each array is decoded with its owning domain input schema. Combining separate files with duplicate arrays in the selling header is rejected. The existing combined starter source remains supported without copying its data into additional fixtures.

The complete `provision` group includes:

1. Auth Users and Customers, identified by stable source keys.
2. Explicit Customer Identity Links using the migrated IDs.
3. B2B Business Units, with parents declared as dependencies.
4. B2B memberships and scoped roles for linked users, using resolved Customer and Business Unit IDs.
5. B2C scoped Permission Grants after identity creation.
6. Catalog prerequisites and B2B pricing/assortment assignments.
7. A terminal completion record depending on every selected stage.

All local files, references and provider bindings are validated before execution. Plans read no remote resources, need no secret credentials and create no Migrate state. The state namespace includes the commerce destination, Shopify app identity where applicable, and the storefront auth application. Execution waits for terminal SDK completion; a failed prerequisite fails the whole setup.

## Provider configuration and behavior

Start with an existing auth application and commerce project/store. The project provisioning commands remain responsible for platform configuration; setup data import does not configure SSO trust, JWT templates, shipping, payments or live checkout. The storefront Store configuration must match the explicit Stores in its selling source.

For Shopify, `read_customers`/`write_customers` scopes alone do not grant protected customer data access. If setup reports that the app is not approved to access the Customer object, configure the installed app's protected customer data access and select the fields used by the setup (name and email; address and phone for those account flows). Shopify documents this separately from OAuth scopes in its [protected customer data guide](https://shopify.dev/docs/apps/launch/protected-customer-data). Apps installed only on development stores need the data/field selections but do not need to submit for review. This access cannot be enabled through the import command.

The starter catalogs include French translations. Shopify setup enables and publishes required catalog translation languages automatically using `write_locales`, before creating metafield definitions or importing translations. It preserves the primary language and unrelated languages and resumes publication safely on rerun. The domain `fr-FR` translation maps to Shopify's native `fr` locale. The store's primary language must already match the catalog default. `--plan` makes no locale requests or changes. Preserve `.migrate` after a failed run and rerun the same command after correcting access or configuration. Migrate SDK skips unchanged successful items.

- **Clerk:** configure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Users are found only by their unique external key. Creation reserves unverified email addresses and supplies no password; enable a supported passwordless sign-in method. B2B uses the `app_roles` claim. B2C explicit grants use the `app_permissions` claim.
- **WorkOS:** configure `WORKOS_CLIENT_ID` and `WORKOS_API_KEY`. Users are found by external ID and their email remains unverified at creation. External keys must fit WorkOS's 64-character limit. B2B uses the `app_roles` claim. B2C explicit grants use the `app_permissions` claim. WorkOS permits at most 600 ASCII characters per metadata value; oversized metadata documents fail explicitly rather than being truncated. See [WorkOS metadata limits](https://workos.com/docs/authkit/metadata).
- **Shopify:** configure the domain, catalog location/publication IDs, `SHOPIFY_ADMIN_CLIENT_ID` and `SHOPIFY_ADMIN_CLIENT_SECRET`. The command exchanges the client credentials for an Admin token on demand and caches it until before expiry. Do not put the client secret in `SHOPIFY_ADMIN_ACCESS_TOKEN`; that variable is only for an already issued Admin token, supplied without a client secret. Use the same app as runtime: identity links, creation reservations and native role selections use private app-owned Shop storage. Root Business Units create a company and purchasing location; descendants become additional locations in that company. Shopify does not acquire a native Business Unit hierarchy. Shopify memberships use the company's native default role. For linked site users, setup writes the application role keys from the membership row to `application_roles` for that Shopify location. A native reservation blocks a second attempt when Business Unit creation is unconfirmed. The Business Unit tracking record supplies the native Location ID for updates.
- **commercetools:** configure the project/region, client credentials, scope and catalog Store/channel IDs. Provision the catalog Store/channels with the project command first. Create native Associate Roles whose keys match the membership input (for the sample, `admin` and `buyer`). Configure their native permissions in the project. Setup applies those keys to the Associate and projects them to `application_roles` for the linked site user. Company and Division creation uses explicit Stores and Associates without inherited membership. Creation inputs use one complete street line as `streetName`, with no separate street-number field.

New auth profiles are not silently adopted by email, and existing email/key conflicts fail. Explicit source relations authorize these administrative identity links; they are not shopper sign-in proofs or session tokens. The shopper must still authenticate through the configured provider.

Imports add or update declared resources. For B2B, updating a membership row replaces its role set for that Customer and Business Unit. Removing a row leaves the existing user, membership and roles in place. Configure the customer session to expose `application_roles` as `app_roles` with `auth claims provision`, then refresh the session. An explicit empty B2C Permission Grant clears its own scope. Updates preserve unrelated scopes, metadata, memberships and profile authentication settings. Do not run concurrent metadata writers for the same users.

## Tax setup

Both B2C and B2B `commerce data setup` accept an optional pair of JSON files:

- `--taxes`: shared Tax Classes and explicit Product assignments, decoded by Commerce Core's `CatalogTaxSetup` schema.
- `--tax-config`: the selected provider's native configuration. Rates and collection settings belong to that provider, rather than the shared catalog model.

Supply both flags together. These files are optional when tax is already managed elsewhere. Opting into this setup requires exactly one Tax Class assignment for every Product in the profile's catalog, including exempt or zero-rated Products. Class keys and references are validated before execution. Each Product tax assignment resolves its own successful Product record from Migrate tracking. Commercetools also tracks Tax Categories, Shipping Method assignments and project tax settings separately. All Variants of an assigned Product share its classification.

The bundled assignment files are `packages/commerce-core/catalog/b2c-tax.json` and `b2b-tax.json`. A custom source looks like:

```json
{
  "classes": [{ "key": "standard", "name": "Standard goods" }],
  "products": [{ "productKey": "bottle", "taxClassKey": "standard" }]
}
```

For Shopify B2C, run from the composed project root:

```sh
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" commerce data setup \
  --directory "$PWD/packages/commerce-b2c/provisioning" \
  --taxes "$PWD/packages/commerce-core/catalog/b2c-tax.json" \
  --tax-config "$PWD/packages/commerce-shopify/provisioning/tax-config.example.json" \
  --state-directory "$PWD/.migrate" --plan
```

Remove `--plan` to apply. For commercetools, use `packages/commerce-commercetools/provisioning/tax-config.example.json`. For B2B, use the B2B profile and `b2b-tax.json`, and include the existing provider-specific `--bindings` argument. Planning validates local files and declares the tax stage without acquiring tokens, reading native settings or changing the shop.

### Commercetools

The example contains **illustrative sandbox rates, not production tax rules**. Copy and edit the provider JSON before applying it to your project. Each class maps to a native Tax Category key and explicit keyed rates with a decimal `amount` (`0.10` means 10%), `country`, optional `state`, and `includedInPrice`. An explicit zero amount models a zero rate; a missing rate does not mean zero. No rate is inferred from a Store, locale or currency.

The stage creates or updates Tax Categories, assigns them to imported Products, and updates the existing Shipping Methods named in `shippingMethods`:

```json
{
  "shippingMethods": [
    { "shippingMethodKey": "standard-delivery", "taxClassKey": "standard" }
  ]
}
```

This is the `shippingMethods` field within the full provider document. The example's empty array leaves Shipping Methods unchanged; it does not make shipping tax-free. Create the native Shipping Methods and zone/rate configuration separately, then list their actual keys here if this command should manage their Tax Categories.

State values must exactly match the shipping address's native `state` (the application's `region`). Country-only rates do not cover addresses with a state unless native country fallback is enabled. `countryTaxRateFallbackEnabled`, when supplied, explicitly updates the project setting; omitting it leaves that setting alone. It affects the entire project. The example enables it for its illustrative country rates. See [Tax Categories](https://docs.commercetools.com/api/projects/taxCategories) and [Project configuration](https://docs.commercetools.com/api/projects/project).

Provisioning credentials need `manage_tax_categories` (or `manage_products`) and `manage_products`; managing shipping assignments also requires `manage_shipping_methods`. Changing country fallback requires `view_project_settings` and `manage_project_settings`. Each scope is qualified by the project key. These are provisioning permissions, not extra runtime permissions.

Updates use native versions and replace only rates with declared keys. Unlisted rates remain intact. A differently keyed existing rate for the same country/state fails for explicit reconciliation. The command does not create an external tax engine or change Cart tax mode; native Platform tax calculation uses these assignments after a shipping address is supplied. Existing Carts can require native recalculation to pick up changed rates.

### Shopify

`classes` maps each shared `taxClassKey` to native Variant `taxable`. Optional `productCategories` entries map a `productKey` to an exact Shopify Taxonomy Category GID. They are native product classifications, distinct from storefront collections. An empty array preserves existing categories. Updates use [productUpdate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productUpdate) and [productVariantsBulkUpdate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/productVariantsBulkUpdate), with `read_products`/`write_products` access. The deprecated Avalara `taxCode` field is not used.

Before tax-related product writes, the stage reads native `Shop.taxesIncluded` and `Shop.taxShipping` and checks them against the explicit `expectedShopSettings` in the provider JSON. A mismatch fails with instructions to change **Settings → Taxes and duties**. This checks shop-wide price inclusion and shipping-tax settings; it does not validate country registrations, collection regions, market overrides or exemptions. Those must be configured in Shopify Admin. A successful setup applies the supported product settings, and does not claim tax collection is fully configured. Hosted checkout remains responsible for calculating final tax.

### Retry and ownership

Tax setup is a Migrate stage after catalog publication and before B2B company catalog assignments. Failed writes can leave earlier native changes applied; rerun the same command with the same state directory after correcting the failure. Native destinations read current resources and avoid unchanged writes. Migrate skips unchanged successful tax input, so rerunning this command is not a remote drift check. Changing the shared assignments, provider configuration or catalog input changes the tax source revision. Existing user, identity and catalog migrations retain their normal progress tracking.

## Verification limits

Package tests exercise the complete B2B/B2C SDK graphs, native destination protocols, dependency failures, retries, conflict checks and unchanged-record skipping. Named-workspace CLI checks verify recipe selection and credential-free planning. Actual Shopify Plus/WorkOS/Clerk/commercetools behavior, authentication continuity and live checkout require the configured sandbox.
