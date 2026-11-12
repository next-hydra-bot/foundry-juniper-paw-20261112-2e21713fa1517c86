# Shared starter catalogs

`b2b.json` and `b2c.json` are the provider-neutral source. Both Shopify and Commercetools import these exact files using their own Migrate SDK definitions. Edit these files rather than maintaining a provider-specific copy.

| Source | Products | Variants |
| --- | --- | --- |
| `b2b.json` | Excavator, mobile lift, pallet truck, replacement attachment | 6 |
| `b2c.json` | Trail jacket, hiking shirt, daypack, insulated bottle | 10 |

These are independent starter datasets. The B2B dataset exercises equipment attributes; installing or importing it does not enable company purchasing on a provider.

## Input model

A catalog is a JSON object with `defaultLocale`, `categories`, and `products`. The default locale identifies the language of the base titles and descriptions. Stable product `key` values and variant `sku` values identify the source records. Each product declares its `productType`, title, description, option definitions, `categoryKeys`, `relatedProductKeys`, and `translations`. Category keys must reference definitions in the same catalog. Categories are flat and have stable keys, base titles/descriptions and translations. Each variant supplies typed `attributes`, `optionValues`, a Core `price`, initial stock `quantity`, and an ordered `images` gallery. Images carry an absolute HTTP(S) `url`, optional `altText`, and positive integer `width`/`height`. Repeated URLs within a product must have the same metadata. Both starter catalogs use AI-generated studio photos, with originals and generation prompts in `images/b2b/` and `images/b2c/`. B2C sizes share the same photo; jacket and backpack colors have separate photos. B2B has a separate photo for each excavator model and lift color, plus the pallet truck and replacement bucket. Their public CDN URLs can be imported by either provider. Replace demo imagery with verified product photography before launch.

Prices use integer minor units: `{"regular":{"centAmount":2500,"currencyCode":"USD"}}` means USD 25.00. An optional `discounted` amount must be lower than `regular` and use the same currency. Provider adapters decide how to represent those two prices natively.

Attributes are validated with Core's generated Product Type schemas. Selection attributes such as model, size and color must agree with the variant's option values and the product's option definitions, including labels. Related products use source keys; the provider resolves remote IDs after all products have imported. The JSON contains no Shopify metafields, Commercetools resources, access tokens, location IDs or channel IDs.

For generated catalogs and future tool calls, import `decodeCatalog` and `catalogJsonSchema` from `@repo/commerce-core/catalog`. `catalogJsonSchema()` exports the structural JSON Schema; run `decodeCatalog(input)` before provisioning to also check unique identities, option combinations, valid prices and related-product references. `loadCatalog(name)` from `@repo/commerce-core/catalog/files` is the Node-only loader for these bundled JSON files. Core has no dependency on Migrate SDK or either provider.

Product and category `translations` are keyed by supported application locale, for example `"fr-FR": {"title":"Veste de randonnée","description":"Une veste légère."}`. Every supplied translation contains both fields. The default locale uses the base fields and must not be repeated inside translations. Keys, product handles and category slugs stay stable across languages. Both fixtures include English base content and French translations.

Product/category titles and descriptions use the catalog's content translations. Attribute names and enum display labels use the Product Model's localized `labels` maps. Commercetools imports these into native Product Type definitions; Shopify's final product migration registers native option name and option value translations for languages used by the catalog. The starter catalogs use the same copy for US and Canadian English and include Canadian French product, category, and option copy. The original French translations remain available. Stable attribute and enum keys are unchanged across languages. Attribute text values, image alt text, translated slugs, category hierarchy, tax setup, shipping configuration, customer-specific prices and ongoing stock synchronization remain outside this translation mapping. Locale visibility, currency and Store/Market routing remain provider configuration.

## Provider execution

See the selected provider's `catalog/README.md`:

- [Shopify import](../../commerce-shopify/catalog/README.md): native variants/options, typed metafields, collections, inventory and publication.
- [Commercetools import](../../commerce-commercetools/catalog/README.md): native Product Types and attributes, embedded prices, inventory channels and Store Product Selections.

Composition includes the source and provider tooling. It never executes an import. Initial quantities become authoritative when an item is explicitly processed again; use development targets and review the provider guide before resetting stock after purchases.

## Agent-authored product models and catalogs

`product-model.json` is the provider-neutral authority for Product Types, attribute types, required fields, localized labels, enum keys/labels, variant option dimensions and optional Cart summary fields. The JSON files in the Commercetools schema directory are no longer the input to this catalog workflow. Each provider derives its native definitions from the installed Core model. Application schemas and TypeScript discriminated unions are generated from the same model.

An agent can author a complete model and any number of catalog files. Use stable identities and supply every Product Type referenced by those catalogs. To keep using the bundled fixtures, retain their Product Types in the model. Supported attribute types are `text`, `number`, `integer`, `boolean`, `enum`, and `product-reference`. Set `list: true` for unique lists. Attributes have `key`, `type`, `labels`, and `required`; enums additionally have `values`, each with a stable `key` and localized `labels`. Numeric fields accept `minimum`/`maximum`; text fields accept `minLength`/`maxLength`. A field's optional `variantConstraint` is `same`, `unique`, or `combination`, enforced across each source Product's variants.

`variantOptions` selects scalar text, numeric, or enum attributes used to distinguish variants. Optional `cartSummary` selects attributes for compact Cart display and defaults to those option dimensions. Model labels must include `defaultLocale`. Catalog enum values use `{ "key": "dark-roast", "label": "Dark" }`, where the label matches the model in the catalog's default locale. Options use the same stable keys and model labels. Custom attribute keys require no handwritten provider switch statements.

Optional `searchFacets` selects and orders the Product Type's attribute filters, independently of `variantOptions`. For example, `"searchFacets": ["voltage", "finish"]` can select a numeric characteristic and an enum option from a custom model. Omit it or use `[]` to expose no attribute filters. Every key must name an attribute on that Product Type; duplicate keys and product references are rejected. Labels and enum values come from the attribute definitions; numeric attributes get range controls and other supported types get selection lists. When several Product Types share a storefront, their declarations combine in model order, with the first occurrence determining each shared facet's position. Empty facets are hidden. Category, availability and price remain standard filters.

Changing `searchFacets` does not delete catalog data or remove other indexed attributes. Run `catalog generate` after editing the model, refresh/rebuild the storefront, and re-run `search provision` when adding facets so Algolia receives their facet settings. Shopify and commercetools recipes consume the same declaration; no provider-specific attribute names are needed in the model.

For `product-reference` attributes, source values are other Products' stable keys, or arrays of keys for lists. The import validates references, creates Products without those references, then resolves IDs and writes them before publication. Forward and cyclic references are supported. `relatedProducts` is reserved for the existing optional list relationship supplied by `relatedProductKeys`; do not repeat it inside variant attributes. Commercetools reference fields are initially optional in its native schema so Products can be created before their references exist; Core still enforces a model's required reference values on complete inputs and storefront reads.

From the workspace root, export schemas for agent/tool inputs and validate locally:

```sh
pnpm --filter @repo/commerce-core catalog model-schema --output /absolute/path/product-model.schema.json
pnpm --filter @repo/commerce-core catalog schema --model /absolute/path/model.json --output /absolute/path/catalog.schema.json
pnpm --filter @repo/commerce-core catalog validate --model /absolute/path/model.json --catalog /absolute/path/catalog.json
```

The catalog JSON Schema is specialized to the supplied model, including allowed Product Type keys, attributes and enum choices. `decodeProductModel` and `decodeCatalog(input, model)` also validate relationships and constraints beyond structural JSON Schema.

Install the model and generate application types before running provider imports:

```sh
pnpm --filter @repo/commerce-core catalog generate --model /absolute/path/model.json --catalog /absolute/path/catalog.json
```

This command validates both inputs before writing, copies the supplied model into `commerce-core/catalog/product-model.json`, and regenerates `commerce-core/product/generated/attributes.ts`. New types or changed constraints require a storefront rebuild/deployment. The file loader checks a generated model fingerprint and refuses imports against stale generated types. Existing product data updates within the installed model do not require regeneration. No schema compiler or provider client is introduced into application routes.

A custom catalog is a project-owned JSON dataset that follows the installed Product Model. It can contain your own products, categories, variants, images and prices. Declare the file and tracking directory in `migrate.config.ts` in a package that depends on your provider and `migrate-sdk`.

```ts
import { defineCatalogMigrationConfig } from "@repo/commerce-shopify/catalog/migrate";

export default await defineCatalogMigrationConfig({
  catalogs: { coffee: new URL("./data/coffee.json", import.meta.url) },
  stateDirectory: new URL("./.migrate/", import.meta.url),
});
```

Use `@repo/commerce-commercetools/catalog/migrate` for commercetools. The key `coffee` identifies the source in Migrate and should stay stable across edits to the dataset. The provider scopes tracking within the configured directory by destination. Set destination credentials and connection settings in the environment, then run from the package containing the config.

```sh
pnpm exec migrate run --all --plan
pnpm exec migrate run --all
```

If the config declares several catalogs, use `--group coffee` to select only that catalog. For Company Pricing Groups and assignments, see the [company import guide](../../commerce-b2b/catalog/README.md).

Provider compatibility is checked as part of import preparation. Shopify's shared metafield keys must keep compatible native types across Product Types; use distinct keys for different meanings. Shopify supports at most three option dimensions, and the starter importer retains its documented variant/metafield bounds. Required fields and domain constraints are enforced by our validator/readers even where a provider cannot express them natively. Existing incompatible native definitions fail for an explicit schema migration; the importer does not automatically delete fields, change types or remove enum values. New model metadata does not automatically create new specification UI, filters or business policies.

## Selling catalogs and company assignments

`b2b-selling.json` supplies the heavy machinery selling profile: explicit Store/locale/currency combinations, named assortments of product keys and named fixed price lists keyed by SKU, and Company Pricing Groups referencing those lists. Each Store declares its public `assortmentKey`. Company assignments select a Store and `pricingGroupKey`; they do not select a company assortment. Product content remains in `b2b.json` and is imported once. Company assignments are owned by Commerce B2B in `catalog/assignments.json`; see the [company import guide](../../commerce-b2b/catalog/README.md).

```sh
pnpm --filter @repo/commerce-core catalog validate-selling --catalog /absolute/path/b2b.json --selling /absolute/path/b2b-selling.json
pnpm --filter @repo/commerce-core catalog selling-schema --output /absolute/path/selling.schema.json
```

The `@repo/commerce-core/catalog/selling` entry point exports validation and JSON Schema for agent-generated selling profiles. It rejects unknown products/SKUs, duplicate identities, unsafe price amounts and ambiguous Store defaults. Commerce B2B validates assignment references, currency compatibility and complete fixed-price coverage for every visible variant. Provider IDs and channel keys are supplied separately by provider-owned binding files. Selling configuration is provisioning input; selecting its Stores for a running storefront remains explicit application composition using Core's configuration.

### Product option selection and swatches

`variantOptions` identifies the attributes exposed as separate Product Detail controls. URLs use their stable keys and value keys, for example `/products/outdoor-trail-jacket?option.size=L&option.color=BLUE`. Both commerce providers use the shared resolver. Partial selections choose a compatible Variant; complete nonexistent combinations remain visible with purchasing disabled. A valid explicit `variant` reference takes precedence.

Enum values may declare optional visual metadata alongside their labels:

```json
{
  "key": "BLUE",
  "labels": { "en-US": "Blue", "fr-FR": "Bleu" },
  "swatch": { "color": "#315D84" }
}
```

A swatch may instead provide `image: { "url": "https://example.com/blue-fabric.png", "altText": "Blue fabric" }`, or both fields. Providers project this into Product Options; native Shopify swatches take precedence. Other values render as text buttons. Regenerate Core types after changing the model using the existing catalog generation command. Swatches do not alter option identity, attributes, prices or cart references.
