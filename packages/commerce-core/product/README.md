# Catalog browsing

Commerce Core owns the `ProductCategoryDetail` read model, category presentation and `ProductDiscovery.findCategoryBySlug` / `listCategories` operations. A category's opaque provider ID identifies the native record; its stable key identifies its classification in Search, independently of its localized URL slug. This localized read model extends the Product Category reference; catalog provisioning retains its multilingual `CatalogCategory` input.

The Commerce Search recipe installs `/categories` and `/categories/[slug]` beside `/products`, with the configured locale prefix. The Products page links to the category index. Category pages read their localized title and description from Commerce and reuse the selected Search provider for products, facets, sorting and pagination. A missing or unpublished category renders the app's not-found page. Search failures use the existing listing error state.

Commercetools maps native Category IDs, keys and localized slugs. Categories require a key and a name/slug for the requested locale. Shopify maps published Storefront Collections, using their original handles as stable keys and their localized handles as slugs. Both adapters paginate category discovery. Shopify reads original handles by collection ID with the default language context; it does not infer identities from translated labels or require Admin credentials for these public reads.

Category scope is added to every logical product search request after InstantSearch builds its facet queries. The browser proxy and server renderer apply the same scope, including price-sort replicas. URL refinements cannot replace it. Existing Store/market eligibility and buyer pricing still apply; category browsing adds no company-assortment filtering.

Publish Shopify collections and their products to the configured Headless storefront. Algolia's Shopify connector also needs Online Store publication and an indexed category mapping; run the existing search provisioning/indexing setup after catalog changes. Category pages do not create a second native product search implementation or trigger indexing at request time.
