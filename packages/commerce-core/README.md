# @repo/commerce-core

The shared commerce domain and storefront: schemas, capability definitions, catalog discovery and presentation, product views, cart UI and programs, Next.js bindings, server action procedures and cart cookies. This is the baseline implementation, with no dependency on a buying-context package, checkout workflow or provider implementation.

| Package | Owns |
| --- | --- |
| `commerce-core` | Domain schemas and capabilities, shared storefront UI, shopping programs and framework integration |
| `commerce-b2b` | Company buying context, member workflows, account UI and company selection |
| `commerce-b2c` | B2C purchasing context, customer registration and account workflows |
| `commerce-checkout` | Complete application-managed checkout, including UI, HTTP and order recovery |
| `commerce-commercetools` | Commercetools capability implementations and administration tooling |
| `commerce-shopify` | Shopify catalog, private cart persistence and hosted checkout |

Applications select stable provider Layers, a buying-context resolver and a request-scoped Current Cart Layer through `makeCommerceBaseApp`. `CurrentCartStorage` supplies provider-owned selection and persistence without requiring account-cart lookup or custom checkout commands. They add `makeCheckoutApp` when selecting custom checkout. The application remains the composition root, including for blended personal and company purchasing.

A Store configuration explicitly declares each supported `(storeKey, locale, currency)` combination and the default Store for each locale in [`store/index.ts`](store/index.ts). Locale selects presentation language; it does not determine currency. Commerce Core owns these selling settings and the optional `displayName`/`displayCode` used to present them. I18n owns supported locales, translations, routing and formatting; it has no selling-currency table. Providers bind the configured Stores to native Market/country/language settings. Request composition selects a configured Store, and shopping uses that resolved context. Configuration rejects duplicate Store/locale rows and requires exactly one explicit default per configured locale.

The package-owned `StoreSelector` supplies the design system with labels, currencies and locale navigation from this configuration. It exposes the default Store for each locale, preserving the existing locale-switching behavior; selecting non-default Stores remains an explicit request selector. The Commerce recipe fills the header selector slot. CMS-only composition uses a currency-free language selector. The design-system `RegionSelector` accepts presentation props and a selection callback and imports no commerce model or selling configuration.

Package-owned views use `@repo/commerce-core/bindings`, which recipes bind to application-owned runtime code. Company UI and custom checkout have separate runtime aliases. Providers import the framework-independent `domain`, `services`, `product` and `store` entry points in core. Import checks prevent those modules from depending on UI or Next.js bindings.

The design system owns visual props, callbacks and slots. Core adapts domain models into those props and owns cart context, action-result handling, connected cart views and product purchase behavior. The design system has no dependency on commerce.

Order history uses `OrderQueries.list` with an explicit Store selection and optional `OrderFilters`: exact Order/PO numbers, UTC creation bounds, and independent payment, fulfillment and cancellation statuses. The history page keeps selections in its URL, preserves them through detail and pagination, and starts a fresh page when filters are applied. Date controls include the final selected UTC day; the domain uses an inclusive start and exclusive end. Providers apply supported native filters and check the recorded values on the backend. Where native filtering is unavailable, each read scans up to five authorized native pages and returns a continuation for unfinished searches. No matching rows with a continuation means the search is still in progress, not that the entire history is empty. Filters never grant access or replace Customer/Business Unit and Store restrictions.

`VariantId` is an opaque purchasable reference supplied by the selected provider. Product Detail, Cart and add-to-cart use the same reference; shared code and API clients pass it unchanged. Adding merchandise takes `{ variantId, quantity }`. Providers resolve any native identifiers internally: commercetools encodes its Product ID and product-local variant number; Shopify uses its globally identifying variant ID directly. Product IDs remain catalog/descriptive identity and SKUs remain optional business identifiers, independent of the purchase command.

There is no `commerce` umbrella, separate contracts package or compatibility alias. A future provider-managed checkout can supply its own complete package and recipe; it need not implement the custom checkout steps or a shared checkout engine.

Run `pnpm --filter @repo/commerce-core test` and `typecheck` for focused package verification. Repository-wide architecture checks belong to the maintainer tooling and run through `pnpm boundaries`; they are not installed into composed applications. Application checks require a current named workspace composition.

The [shared domain catalogs](catalog/README.md) provide validated JSON sources and a JSON Schema for authoring/tool inputs. Provider-owned Migrate SDK definitions map these sources into Shopify or Commercetools.

## Catalog caching

Public product data, SEO metadata, fixed Product Collection grids, category metadata and the category index use `use cache: remote`. Direct Shopify product reads and category reads use `cacheLife("max")`; commercetools product reads use `cacheLife("hours")` because Product Search index updates lag resource events. Missing products retain `cacheLife("minutes")`. Provider recipes bind `product/public-catalog` to a public catalog runtime with no cookies, customer tokens or cart. The default Store is resolved from the explicit locale configuration. Cache entries are separated by locale and read arguments; provider/configuration changes produce a new deployment's cache keys. Signed native catalog events invalidate entries across all configured locales and currencies.

Product details and grids tag every returned product ID. Product changes expire that product's entries, product lists and cached missing-product lookups. Category changes also expire product data because product details embed category names and URLs. Inventory and other changes without a product ID expire the public catalog broadly. Provider identity remains opaque in Core. Repeated or out-of-order events are harmless expiry operations; the next read fetches current provider state.

Public headings, descriptions and cards render independently of buyer authorization. URL-selected product media waits only for URL selection; buyer prices and purchase controls stream in separate Suspense boundaries. Each collection shares one request-time buyer lookup across its price slots. Buyer authorization is resolved outside shared caches. Authenticated customer/company prices and availability remain request-bound; carts, checkout and customer sessions do not enter these caches. Public SEO metadata is independent of the viewer's company prices. Static CMS/page shells retain their existing ordinary `use cache` policies. Public commerce reads have their own lifetime even when embedded in a CMS block.

Configure a remote cache handler on the host. Vercel supplies platform integration; self-hosted applications must configure [`cacheHandlers`](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheHandlers). The directive alone does not provision storage. Follow the selected provider's catalog-event setup before relying on long lifetimes. Local development and mock tests do not prove distributed cache persistence.

Search retains its short `minutes` lifetime, now using remote storage. A product webhook does not immediately expire Algolia responses: ingestion completes separately and immediate expiry could refill the cache from the old index. Native catalog invalidation does not reindex Algolia or push refreshed results into an already-open browser. Product Search and Storefront API reads retain their providers' consistency guarantees.

Agent-authored Product Models and catalogs are JSON inputs owned by Core. See [catalog authoring and generation](catalog/README.md#agent-authored-product-models-and-catalogs) for validation, generated application types and provider import commands.
