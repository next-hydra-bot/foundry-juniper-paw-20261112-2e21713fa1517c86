# Shopify commerce provider

The default assembly supports guest B2C catalog discovery, cart line changes and Shopify-hosted checkout. The `commerce-shopify-customer-accounts` add-on supplies authenticated B2C purchasing. The alternative `commerce-shopify-b2b` add-on supplies company purchasing: verified company-location selection, buyer-context catalog prices, separate company carts and hosted checkout. Both authenticated assemblies reuse the same Shopify Plus customer session with the selected WorkOS or Clerk Auth Provider. The B2B recipe also installs member listing, Buyer invitations, Buyer access removal and company details/address editing. B2B also includes company applications, review and native company onboarding, with the registration API and Admin applications. Order-history pages remain separate.

Select `shopify` for the existing commerce provider slot. The package-owned `commerce-shopify-b2c` recipe supplies the application runtime bindings and checkout route. Domain-coupled catalog/cart UI stays in Commerce Core. The application explicitly composes the buying context and concrete provider Layers.

## Setup

For the complete dependency order, private credential handoffs, identity setup and redirect-theme commands, see [storefront provisioning](docs/provisioning.md).

Install the Headless channel, publish products and collections to that storefront, and configure its private Storefront API token in the web application's environment. See `.env.example`. Enable `unauthenticated_read_product_listings` and `unauthenticated_read_product_inventory` for the queried catalog fields, and `unauthenticated_read_customers` for the cart buyer-identity query (see [Storefront Customer scopes](https://shopify.dev/docs/api/storefront/latest/objects/Customer)). Product inventory permission is needed for the detail page's `quantityAvailable` field. The catalog import's `SHOPIFY_CATALOG_PUBLICATION_ID` must identify this Headless storefront's publication; publishing only to Online Store does not make the catalog available through the Headless token. The API version is pinned to `2026-10` and can be configured explicitly.

In Shopify Admin, open **Headless**, select the storefront that issued the private token, enable those **Storefront API permissions**, and save. The Admin app's `read_inventory` scope does not grant Storefront inventory access. Provisioning publishes the catalog to the explicit publication ID; it does not configure the Headless token's permissions or automatically select a publication by name.

Declare selling contexts in [Commerce Core's Store configuration](../commerce-core/store/index.ts): `storeKey`, `locale`, `currency`, `isDefault` and optional display labels. This is the same configuration used by the Core shopping UI and both providers. In [`shopifyConfiguration` in `store.ts`](store.ts), bind each Core `(storeKey, locale)` to a `marketKey`, native buyer `country` and Shopify `language`. Each Market declares its stable `key`, native `handle`, `name`, `currency` and complete `countries` list. Shopify bindings do not repeat Core currencies or defaults. Validation requires one native binding for every configured Core Store/locale and checks its currency against the declared Market; changing Core selling settings therefore requires reconciling the provider binding before provisioning or shopping. Neither currency nor native country is derived from locale.

Catalog queries, cart buyer identity, cart validation and the customer login handoff use the same explicit Store mapping. Unknown Store/locale/currency combinations fail rather than falling back to a locale-only native context. Configuration rejects duplicate Store mappings, ambiguous locale defaults and disagreement between a Store and its Market's currency/countries. This country-selected integration requires configured Markets to have distinct country sets. A mismatched returned currency also fails rather than displaying a mislabeled price.

The selected Shopify provider installs `commerce project provision` into the workspace administration CLI. It configures Markets on an existing shop using `SHOPIFY_STORE_DOMAIN` and Admin credentials with `read_markets` and `write_markets`. Load these import/setup credentials through the CLI's `--env-file`; they do not belong in storefront runtime credentials.

```sh
pnpm --filter cli cli --env-file .env.bootstrap.local commerce project provision --dry-run
pnpm --filter cli cli --env-file .env.bootstrap.local commerce project provision
```

The command provisions the Markets referenced by the declared Stores. The bundled configuration explicitly defines North America (US/USD), United Kingdom (GB/GBP) and Europe (DE, ES, FR, IT, NL, PT/EUR). `--stores default-store` selects every Market explicitly mapped to that Store across its configured locales (North America and Europe in the bundled configuration). Selecting a Store in a shared Market provisions that Market's complete declared country set. Markets are never grouped by currency.

Existing Markets are matched only by the declared native `handle`. Set that handle to your shop's existing Market handle when adopting a Market; a different handle with matching countries is reported for explicit configuration, never silently adopted. The command activates matching Markets and sets their declared single currency, or creates missing Markets using their explicit names and handles. Unchanged settings produce no writes. Repeated runs read Shopify's current state; they do not rely on a local migration record. Names, country membership, catalogs, domains and unrelated Market settings are preserved on updates. A handle with different country conditions stops Market planning before Market writes. Existing broader or more specific Markets are not merged; review the dry run and Shopify's resulting Market hierarchy. A Market with more than 250 region entries requires manual reconciliation.

Shopify Payments or a supported Adyen setup must already support the requested currencies. Provisioning cannot activate the payment provider, configure payout/bank accounts, or enable its test mode. Shopify's plan and account restrictions still apply and native rejections are reported. This command does not change the shop's base currency, provision shipping rates, import products or publish languages. Use the catalog import below after shop setup. Multi-Market writes are not transactional: after a failure, run `--dry-run` to inspect changes already applied before retrying. See [Shopify Market creation](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/marketCreate), [Market updates](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/marketUpdate), and [currency requirements](https://help.shopify.com/en/manual/markets/customizations/local-currencies).

The provider uses `@shopify/hydrogen` 2026.10.2 for its typed Storefront client and `gql` documents. The package TypeScript configuration enables Hydrogen's editor completions and query validation, and `typecheck` also runs `hydrogen gql check --fail-on-warn`. Keep the configured API version aligned with the SDK's bundled schema. Effect retains cancellation, sanitized failures and domain orchestration; Effect Schema still validates provider responses and domain constraints.

Each operation creates its SDK client from the current Store and request headers. Production requests require a trusted buyer IP in `SHOPIFY_BUYER_IP_HEADER`, which defaults to Vercel's `x-vercel-forwarded-for`. Other deployments must configure a header their trusted proxy overwrites. Local development without that header uses loopback. Only Shopify cookies are forwarded; application auth and private cart cookies remain local.

Public cached catalog reads instead use Hydrogen's `private_no_buyer_context` mode, with the same private Headless token and explicit Store localization. They forward no buyer IP, cookies or customer identity. Authenticated purchasing retains the request-aware client above.

## Provision catalog cache webhooks

The commerce recipe installs `POST /api/commerce/catalog-events` for B2C and B2B. It authenticates Shopify's HMAC against the exact request bytes and checks `x-shopify-shop-domain` before expiring Core's public catalog tags. Use the Admin app's client secret, not an Admin access token or a generated unrelated signing key.

Grant the provisioning app `read_products` and `read_inventory` (or their corresponding write scopes). Configure `SHOPIFY_STORE_DOMAIN`, Admin credentials and `SHOPIFY_ADMIN_CLIENT_SECRET` in the CLI environment. Even supplied-Admin-token mode needs that app's matching client secret for webhook verification.

```sh
pnpm --filter cli cli --env-file .env.bootstrap.local commerce webhooks provision \
  --origin https://store.example.com --dry-run

pnpm --filter cli cli --env-file .env.bootstrap.local commerce webhooks provision \
  --origin https://store.example.com --output shopify-catalog-webhooks.env
```

The apply command publishes `SHOPIFY_CATALOG_WEBHOOK_SECRET` and `SHOPIFY_STORE_DOMAIN` through the existing runtime-environment publisher. Load the private output into the web application's runtime environment, or use `--store vercel --environment preview` / `--environment production` to publish to configured projects. `--overwrite` updates provider-owned settings in an existing destination; `--yes` skips confirmation. Dry run reads subscriptions and writes neither subscriptions nor credentials.

Provisioning reuses exact topic/destination matches and creates missing subscriptions. It leaves subscriptions at other URLs alone. Re-run for each deployment origin or after changing a development tunnel; remove obsolete tunnel subscriptions explicitly in Shopify Admin. A reachable HTTPS origin is required, including for local tunnels. Deployment protection must allow Shopify deliveries to this signed endpoint.

Topics cover product and collection create/update/delete, inventory-level connect/update/disconnect, and variant stock transitions. Inventory events invalidate broadly because their payloads do not identify all affected products. Ensure the app subscribes with the same credential whose secret is published. This endpoint is independent of order-workflow webhooks.

Shopify's topic set does not cover every translation, Market configuration or publication change for every channel. Changes that do not emit one of the subscribed topics need an explicit catalog refresh through the existing protected revalidation endpoint (`commerce:products`, `commerce:categories`, `commerce:product-lists`, `commerce:product-lookups`), or a new deployment. In particular, an app's publication events do not prove a different Headless channel changed. Keep this operational step for such changes instead of assuming every Admin edit emits `products/update`. The long cache lifetime has a timed fallback; see [Core cache policy](../commerce-core/README.md#catalog-caching).

Verify one signed delivery in Shopify after setup and confirm a product edit appears on a subsequent storefront request. Duplicate events safely expire the same tags. No Algolia ingestion or long-lived search-cache invalidation is claimed by this command.

This integration uses the SDK clients and, in the authenticated recipe, its customer-session manager. It retains the existing shopping UI, forms and private cart storage. Core owns the existing shopping UI and actions; the provider continues to own its private cart cookie and hosted checkout route.

Composition copies code and dependency declarations. It does not create a Shopify store, change permissions, configure Markets or write credentials.

## Runtime Admin credentials

Authenticated B2C identity storage and B2B administration share `ShopifyAdminAccessToken` through the existing runtime Admin client. Set `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_CLIENT_ID` and `SHOPIFY_ADMIN_CLIENT_SECRET` for the installed Admin app. These are the Admin app's credentials, separate from the Headless Customer Account client ID and the Clerk/WorkOS OAuth client. Shopify's client-credentials grant requires the app and shop to belong to the same Shopify organization.

The service makes no network request when its Layer is constructed. The first Admin operation obtains a token; simultaneous callers share the acquisition. Successful tokens are cached in memory for that app/shop and runtime instance. Cache lifetime follows Shopify's `expires_in`, subtracting the acquisition time and a safety margin of 10% capped at 60 seconds. The next operation after cache expiry obtains a replacement. Failed acquisitions are not cached. Each server process or cold start has its own cache; no token is written to cookies, files, Next.js caches or browser code.

Alternatively, configure `SHOPIFY_ADMIN_ACCESS_TOKEN` alone for a separately managed token. Exactly one mode is required; mixing a supplied token with client credentials is rejected. Supplied tokens are used as provided and remain the operator's responsibility to renew. Changing credentials requires restarting or redeploying the runtime.

An Admin HTTP 401 invalidates only the token used by that failed operation. The operation returns its existing failure without replaying a mutation; the next independent operation acquires a fresh token. A delayed rejection of an older token does not discard its newer replacement. Requests use Effect's HTTP client with cancellation, a 30-second timeout, disabled fetch caching, rejected redirects and redacted Admin authentication headers. Hydrogen remains the client for Storefront and Customer Account operations, wrapped in Effect.

The full `commerce data setup` command and Migrate SDK catalog imports also provision required catalog translation languages automatically. Grant `read_locales` and `write_locales`; preflight enables and publishes missing languages while preserving the primary language and unrelated locales. Plans do not contact Shopify or change languages.

The provisioning CLI and Migrate SDK catalog commands share this token acquisition and cache implementation. Set `SHOPIFY_ADMIN_CLIENT_ID` and `SHOPIFY_ADMIN_CLIENT_SECRET` in the import/setup environment; the first request exchanges them for an Admin token. Do not put the client secret in `SHOPIFY_ADMIN_ACCESS_TOKEN`. A separately managed Admin token remains supported. Provisioning commands prefer that token when both it and the app secret are configured; webhook signing still uses the app secret. Runtime token configuration retains its explicit authentication modes. Full data setup also requires the app client ID to identify the destination for private storage and saved migration state. Migrate data plans acquire no tokens and make no destination requests; `commerce project provision --dry-run` reads Shopify configuration without applying changes. Composition installs the modules and examples without acquiring credentials or calling Shopify.

References: [client-credentials grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant), [token lifetimes](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens).

## Initial catalog imports

The package includes separate B2B equipment and B2C outdoor datasets, imported through Migrate SDK. See [catalog setup and commands](catalog/README.md). Provisioning uses separate Admin credentials and is never run by composition or storefront requests. Typed product and variant metafields are decoded into Core attributes, while native Shopify options drive variant selection and cart summaries.

## Cart and checkout

Store attribution records the Store where the purchase began, independently of Shopify's regional or B2B pricing Markets. Cart creation writes the server-resolved Store key through `cartMetafieldsSet` to `commerce.store_key`, confirms the native response, then persists its private credential. Every subsequent Cart projection verifies this recorded key against the current Store; neither a cookie nor a matching currency establishes attribution. Changing Stores resolves a different Cart rather than relabeling the existing one.

The shared `shopify-order-attribution` migration creates the matching `ORDER` metafield definition with `cartToOrderCopyable` and `adminFilterable` enabled. Both catalog import flavors use that definition. Shopify copies the value when checkout creates the order. No webhook or runtime Admin request is needed for that copy. Run provisioning before testing new carts; attribution is not backfilled onto existing orders. A checkout destination or currency change does not change the Store of origin. See [Shopify cart-to-order copying](https://shopify.dev/docs/apps/build/metafields/use-metafield-capabilities#cart-to-order-copyable).

The complete Shopify cart ID is an authority-bearing credential. The provider retains it in a shop, Store and locale-scoped HttpOnly cookie. Public cart projections contain a SHA-256 correlation ID, never the credential. Cookie persistence happens during cart mutations, not Server Component reads.

`CurrentCartStorage` supplies selection and persistence to Core's shopping programs. This provider does not implement Commercetools account-cart discovery or application-managed checkout commands. Mutations are never automatically retried after an uncertain response; callers receive `CartWriteOutcomeUnknown`. Declared Shopify user errors become `CartMutationRejected`, while returned cart state remains authoritative for automatic quantity adjustments.

The checkout route reads a fresh cart and checkout URL, evaluates Core cart policies against that snapshot, then redirects. Shopify owns checkout and its order confirmation. This assembly does not claim that returning to the application proves an order or payment exists. The guest assembly retains carts per browser, with no cross-device recovery or association on site sign-in.

Provider-local availability, pricing and checkout behavior must also be configured in Shopify. Core cart policies alone cannot prevent someone using Shopify's hosted checkout directly.

### B2C checkout browser tests

The Shopify B2C recipe with the customer accounts add-on includes two Playwright BDD scenarios. They cover placing a guest test Order and carrying the guest Cart through sign-in to Shopify Checkout.

Use a dedicated Shopify Plus sandbox with the seeded B2C catalog, a US shipping rate, and [Shopify's Test payment gateway](https://help.shopify.com/en/manual/checkout-settings/test-orders/payments-test-mode) active. The sandbox Checkout must be accessible to a fresh browser without a store password prompt. Connect Shopify Customer Accounts to the same test identity provider as the storefront and register the Headless Customer Account callback for the exact HTTPS storefront origin. Set `E2E_SHOPIFY_CHECKOUT_ORIGIN` to the sandbox's hosted checkout origin, with no path. The payment step checks that origin and the visible test gateway before submitting test card details. Cancel completed test Orders in the sandbox and restock the test variant between runs.

After composing the workspace and checking freshness, start the configured applications and run:

```sh
E2E_SHOPIFY_CHECKOUT_ORIGIN='https://<sandbox-checkout-host>' \
  pnpm --dir workspaces/shopify-b2c test:e2e -- --grep 'Shopify B2C Checkout' --workers=1
```

## HTTP API for mobile clients

Select the optional `commerce-shopify-api` recipe to expose catalog, authorized company locations, cart operations and hosted-checkout start under the storefront origin's `/api/commerce`. Core owns the shared shopping contracts; Shopify and the selected Auth Provider supply request credentials and native operations. Both Clerk and WorkOS are supported without installing company registration for B2C. See the [HTTP integration guide](http/README.md) for mobile OAuth, headers, opaque cart sessions and current completion scope.

## Customer account management

Commerce Core provides the persistent account layout and a site-authenticated overview at `/[locale]/account`. The authenticated B2C recipe adds Commerce B2C's profile and saved-address forms at `/[locale]/account/profile` and its order pages. Commerce B2C owns their content, workflows and Actions; Core owns `CustomerProfiles` and `AddressBook`; this provider supplies Customer Account API adapters. Applications contain thin routes and runtime composition. B2B supplies its company-location editor and member-management screens inside the same account layout.

The selected Clerk or WorkOS session signs the shopper into the storefront. The account home reads only the selected site-auth session and does not prepare a Shopify customer session. Customer-detail and Order links use App Router navigation without prefetching; only a required Shopify customer connection uses a document handoff, so background prefetch cannot start their handoff. Opening `/account/profile` explicitly completes the Shopify customer-session handoff before reading or editing native details. Its Headless Customer Account API client needs `customer_read_customers` and `customer_write_customers`. Consumer account editing uses the authenticated Customer Account API, without an Admin API token. Names are updated for the connected customer only; submitted forms cannot select a customer or change the sign-in email. Profile reads fetch current native details. Successful writes refresh the encrypted profile in the current request's cookie store, so the next account view shows the saved names. A shared runtime never retains another request's cookie store or selected Store.

Saved addresses are read in full, following every native cursor. Opaque Core references encode exact native address IDs. Updates require a reference in the authenticated customer's current address book; another customer's reference is rejected before writing. Contact names, company and phone fields are preserved when an existing address's postal fields change. The complete street line maps directly to native `address1`; no street number is separated or stored.

Shopify has one default customer address and no shipping/billing categories. Each native address is available for both uses, and the native default is projected into both Core default flags. Separate default flags or categories are rejected rather than emulated. A replacement default can be selected; the current default cannot be cleared without choosing another. Shopify's customer-address API does not support every ISO country accepted by Core; unsupported codes are rejected explicitly, with no country inferred or substituted.

New addresses receive their native ID from Shopify; the returned reference replaces the form's creation reference. Shopify does not provide a client-supplied unique address key. Creation is never automatically replayed and records are never recovered by matching street text. A lost write response, malformed mutation response or failed final read returns `AddressBookWriteOutcomeUnknown`: refresh the account to inspect native state before submitting again. A confirmed native validation rejection is a separate `AddressBookMutationRejected` public failure with `fix_input` recovery. Profile-name writes are idempotent and do not create customers. The account recipe does not install a second registration form; Shopify's configured customer-account sign-in remains responsible for creating the native customer.

These adapters are verified with the real Hydrogen client against controlled HTTP fixtures and composed-workspace checks. Live consent/scopes, native validation and session continuity still need the Shopify Plus sandbox. See [customer profile updates](https://shopify.dev/docs/api/customer/2026-10/mutations/customerUpdate), [address creation](https://shopify.dev/docs/api/customer/2026-10/mutations/customerAddressCreate), and [address updates](https://shopify.dev/docs/api/customer/2026-10/mutations/customerAddressUpdate).

When Algolia is selected, a package-owned recipe supplies Shopify product indexing and the existing shared search UI. B2C uses public market prices. B2B checks the verified selected Company Location against its Store’s configured pricing Markets, paging native membership only until that location is found; the web runtime Admin app requires `read_markets`. It does not use the direct Company Location Catalog connection to infer Market Catalog membership. The Algolia transformer creates one copy per shared group; price filters and sorting use the same numeric price field and shared replicas. Reuse `SHOPIFY_COMPANY_PURCHASING_POLICIES` in the provisioning and server environments. Group copies use daily full replacement, with an immediate refresh on provisioning; native consumer subscriptions remain enabled. The shared Product Model drives typed metafield attributes and storefront filters. Enable B2B indexing in the managed Algolia app and re-sync its company data before provisioning company search. Product Detail, Cart and Checkout use the same verified native buyer context. The managed Algolia Shopify app must be connected and products must be published to Online Store as well as Headless. See [Shopify search setup and provisioning](../search-algolia/connector/shopify/README.md).

## Order history

Authenticated B2C and B2B recipes install `/[locale]/account/orders` and `/[locale]/account/orders/[id]`. The account navigation links to the listing, and both pages render Core's historical order projections. B2C uses the verified site session and a verified customer identity link to read the shopper's orders through the Admin API. The first-time handoff uses the same registered OAuth callbacks with `purpose=account`, retained in the encrypted login state. It establishes customer identity without connecting the Cart; any pending attachment remains required before checkout or a Cart mutation. Guest-only commerce does not install these routes.

Set `SHOPIFY_CUSTOMER_IDENTITY_PROVIDER_NAME` in the web app to the exact name of the Shopify identity provider that uses the same Clerk instance or WorkOS environment as this storefront. With `read_customers`, B2C Orders can also recognize an identity already verified by Shopify even when the private link is missing. The site session email locates the Customer, and the Shopify-recorded provider name and subject must match the configured provider and authenticated user ID. This reads the native association without copying it into another store. A shopper with neither association sees an empty order history and can choose **Find previous orders** to start the handoff.

The `orders/queries` Layer uses the server-side Admin API. Runtime credentials need `read_orders` (or `write_orders`), customer access and the protected customer-data access required to read the displayed fields. B2B also needs company read access. These order scopes expose orders created within the last sixty days. Listing and detail work within that window without `read_all_orders`; listing reports `historyLimitDays: 60` and the storefront displays the limit, including when no recent orders are found. Granting `read_all_orders` removes that rolling limit on subsequent reads. Apps created under a merchant organization for stores in that organization do not need Shopify approval for this additional scope; Partner-organization apps must request approval before declaring it. See [Shopify Order access](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order).

B2C queries the verified Customer's orders and excludes company purchases. B2B queries the selected company location's orders, including colleagues' purchases, after verifying membership and `company.orders.read` for that exact Business Unit. This is the composed application's access policy; it does not depend on Shopify's two native customer role labels. Default company onboarding grants buyers this read permission and administrators all company permissions. Existing test identities must be reprovisioned or granted it explicitly.

Listing defaults to all Stores. An explicit `?store=<Store key>` filter uses the recorded `commerce.store_key` metafield; neither locale nor currency chooses the order's Store. Unattributed orders can appear in all-Store history. Opaque cursors stay bound to the customer/company and selected filter. Detail reads recheck ownership, exhaust line-item and fulfillment pagination and preserve historical descriptions, addresses and presentment currency without looking up today's catalog. Orders changed during pagination fail the read rather than mixing snapshots.

## Shopify Plus customer accounts

Select `commerce-shopify-customer-accounts` in `addOns` with `commerce: shopify` and either `auth: workos` or `auth: clerk`. This single public add-on automatically selects `auth-workos-shopify` or `auth-clerk-shopify` by the selected Auth Provider's canonical ID. Each internal recipe installs its provider's setup guide; OAuth, cart attachment, checkout and application runtime templates are shared. There is no second auth-specific option to select and no company registration dependency.

The add-on replaces the guest runtime recipe and installs five thin GET routes: `/account/login`, `/account/authorize`, `/account/refresh`, `/account/logout/continue` and `/account/logout/complete`. The application still selects concrete Layers in `app-runtime.ts`; provider-owned modules supply OAuth, encrypted session storage, the B2C purchasing context and cart attachment. The selected Auth Provider supplies `authSessionAdapterLayer` through `@repo/auth/server`. A recipe slot wraps locale routing to preserve these fixed protocol paths while retaining authentication and security middleware. Shared Core and B2C domain schemas are unchanged.

Configure these prerequisites:

1. Enable customer accounts on a Shopify Plus store and connect the same identity-provider application/environment used for storefront sign-in. Follow the selected recipe's guide: [Clerk](../auth-clerk/docs/shopify-customer-accounts.md) or [WorkOS](../auth-workos/docs/shopify-customer-accounts.md). Shopify points to the identity provider's hosted OIDC endpoints. The ordinary site session token is not a Shopify credential.
2. Create a **public Customer Account API client on the Headless storefront** with PKCE and refresh tokens. Register `https://<storefront>/account/authorize` and the exact storefront HTTPS origin. This is separate from the OAuth application connecting Shopify to Clerk or WorkOS. An app client that does not issue refresh tokens is not supported by this recipe.
3. Generate `SHOPIFY_SHOP_ID`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `SHOPIFY_STOREFRONT_ORIGIN` and `SHOPIFY_CUSTOMER_SESSION_SECRET` with `commerce customer-accounts`, below, or supply them manually using `customer-accounts.env.example`. Local OAuth needs HTTPS, including for the callback. Never reuse the Storefront token as the session secret.
4. Configure the [runtime Admin credentials](#runtime-admin-credentials) in the web application’s **runtime server environment** using the installed app’s client credentials or a separately managed supplied token. Authenticated web and HTTP API recipes use the Admin API to persist private site-user/Shopify-customer identity links in app-owned Shop metafields (`$app:company_identities`). Use the same installed Shopify Admin app as company identity storage, if present, so web, native clients and company administration share those links. These credentials are needed after provisioning, including for B2C; company registration and administration routes are not required. Never expose the Admin token to the browser or grant public access to these identity records.

From the materialized workspace root, use the private Admin bootstrap file and the **public Headless Customer Account client ID** you created in Shopify:

```sh
pnpm --silent --filter cli cli \
  --env-file "$PWD/.env.bootstrap.local" \
  commerce customer-accounts \
  --client-id "<Headless Customer Account client ID>" \
  --origin "<HTTPS tunnel origin>" \
  --output "$PWD/shopify-customer-accounts.env" \
  --yes
```

The command reads the native Shop ID using the Admin API, validates any supplied Shop ID, generates a private session secret, and writes a mode-0600 runtime file including the configured Admin credentials. A supplied session secret is reused. Existing local output files are never overwritten; preserve the original secret when changing configuration. Load the generated values into the web application's private runtime environment alongside its existing Clerk/WorkOS and Storefront credentials. Alternatively, the standard `--store vercel` destination publishes to the web project. The Headless client ID is separate from the Admin app's client ID and the identity-provider OAuth client ID.

Use the exact HTTPS origin that the browser will visit. Shopify's [Headless setup guide](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started#step-2-configure-customer-account-api-access) excludes localhost callbacks and recommends an HTTPS tunnel for local testing. The CLI accepts an HTTPS Portless origin, but that does not make it supported by Shopify. Keep the application running through Portless and use the tunnel origin for the entire shopping session. Register the printed `/account/authorize` callback and origin in the Headless client. Headless client registration and identity-provider activation remain Shopify dashboard steps; this command generates local configuration and checks Shop identity, not a live sign-in handoff.

Also register `https://<storefront>/account/logout/complete` in that Headless client's **Logout URI** settings. The CLI prints it beside the sign-in callback. When using WorkOS, add `https://<storefront>/account/logout/continue` to WorkOS's configured **Sign-out URIs** as well. These are fixed storefront URLs, separate from the Shopify-owned callback registered with the external identity provider.

The authenticated storefront recipes coordinate sign-out through a writable preparation step. It detaches the selected owned cart's customer/company identity where Shopify accepts the update, discards local Shopify customer/cart credentials, and captures Hydrogen's native logout destination before the site session ends. An unconfirmed cart detach still discards the local credential and never retries an ambiguous mutation. A two-minute encrypted, HttpOnly cookie carries the logout destination through Clerk or WorkOS sign-out. The fixed `/account/logout/continue` route consumes it once, then sends the browser to Shopify's logout endpoint; Shopify returns to `/account/logout/complete`. A replaced or still-authenticated site session does not follow that native logout destination. Admin sign-out and API-only guest storefronts keep their existing independent authentication flows.

Both logout routes require document navigation. Background router requests and prefetches receive HTTP 409 without consuming the one-use cookies. Clerk's composed Sign out control uses the SDK's completion callback to perform a full browser navigation; custom controls must preserve that behavior when continuing to an external logout endpoint.

If Shopify returns another customer during an authenticated login callback, that identity never reaches the cart. The provider logs out that native session and retries the current site's handoff once. A repeated mismatch stops rather than rebinding identities or looping. The recovery is bound to the initiating site session and preserves the intended local return path.

Shopify's customer-account cookies and Shop Pay's wallet are separate browser state. Without a readable Shopify ID token, the SDK cannot end an unrelated ambient Shopify session. Coordinated site/customer sign-out does not promise global Shop Pay logout or invalidation of an already-open checkout. Verify those native browser behaviors in the sandbox; continue using a freshly retrieved, cart-authenticated checkout URL rather than adding `sso=silent`, which selects Shopify's ambient browser session. See [checkout authentication](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/checkout-authentication) and [customer-account logout](https://shopify.dev/docs/api/customer/latest#logging-out).

For tunnel testing, set `PORTLESS_AUTO_ENV=0` in the web application's local environment and keep `NEXT_PUBLIC_WEB_URL`, `CLERK_AUTHORIZED_PARTIES` (when using Clerk), and `SHOPIFY_STOREFRONT_ORIGIN` on the same tunnel origin. The shared Next.js web configuration allows the exact hostnames from `NEXT_PUBLIC_WEB_URL`, `PORTLESS_URL`, and `PORTLESS_NGROK_URL` for development resources, including HMR. Restart the web server after changing its configuration. If the tunnel hostname changes, update the local origins and Shopify Headless callback/origin settings together. Preserve the existing customer-session secret.

The storefront does not collect customer passwords. Clerk or WorkOS handles hosted sign-in and supplies the site identity and profile, including email. Contact-email forms can still collect an email address.

On first checkout after site sign-in, the browser navigates storefront → Shopify Customer Accounts → the configured Clerk or WorkOS identity provider → Shopify → storefront. Hydrogen exchanges the **Shopify authorization code**, using PKCE, state and nonce, for Shopify access and refresh tokens. It does not exchange an ordinary Clerk or WorkOS access token directly for Shopify tokens. Shopify tokens are reused and refreshed; a missing or unusable Shopify session, or a replaced site session, can require the browser handoff again.

The provider resolves the customer through the Customer Account API and persists a unique association between the site user ID and Shopify customer ID. Creating the first association requires matching email from the authenticated site session and Shopify profile; configure the identity provider to return verified email. After that, the immutable IDs establish the association, independently of email changes. An existing user/customer association cannot be rebound to another identity. The current site user/session and Shopify tokens are also bound in encrypted, host-only, Secure, HttpOnly cookies. No email lookup selects or provisions a customer during this handoff.

The existing Clerk or WorkOS session must satisfy the identity-provider flow without another credential prompt; verify this against the configured identity provider and Plus store. Plus alone does not configure federation or prove prompt-free sign-in.

Before that handoff, a signed-in site user still shops as a guest. After it, the provider creates a `B2CPurchasingPrincipal` with the verified Shopify customer ID. The callback attaches an existing guest cart using `cartBuyerIdentityUpdate`, preserving its Market and lines. New carts carry the customer token at creation. Checkout validates locally unexpired tokens with the Customer Account API. When a token expires, it redirects through the writable refresh route, reapplies the fresh token to the cart and reads a current checkout URL. It uses Shopify's cart-token authentication path; it does not append `sso=silent`, which relies on a different browser session.

Authentication and cart connection are tracked separately in the encrypted customer session. A new login or refreshed token marks the connection pending until Shopify confirms the cart's buyer identity, or there is no current cart to attach. A temporary attachment failure keeps the session and cart and offers a checkout retry through `/account/refresh`; the consumed OAuth callback is not replayed. Read-only views keep the cart visible while pending. Cart edits complete the connection before changing lines, and checkout stays blocked until the connection is confirmed. Retrying an uncertain attachment reapplies the same buyer identity without adding or changing cart lines. Carts belonging to another customer remain inaccessible.

Server components only read sessions. Token refresh and cookie writes happen in route handlers or cart-creation actions. Read-only cart operations verify the remote customer ID. A different site user/session or signed-out user cannot select a customer-bound cart. Composed browser sign-out coordinates the current site and Shopify sessions as described above. Sign-out across other devices and recovery of carts across devices are not implemented. Switching users starts a new cart. Expired/revoked tokens and provider failures fail the handoff without falling back to guest checkout or replaying a cart write.

Customer-session and cart tests use the real Hydrogen SDK with controlled HTTP responses. Remote federation, credential-free redirects and a real purchase still need verification against the configured services.

The named `shopify-b2c` (B2C) and `shopify-b2b` workspaces use Contentstack and Clerk, with Algolia search and hosted checkout included. WorkOS remains a supported Auth Provider in recipes. Compose and check freshness before running application tests or typechecks; see [named workspaces](../../workspaces/README.md).

## References

- [Hydrogen typed queries and editor setup](https://shopify.dev/docs/storefronts/hydrogen/data-fetching/typed-queries)
- [Hydrogen Storefront client](https://shopify.dev/docs/storefronts/hydrogen/data-fetching)
- [Bring your own stack](https://shopify.dev/docs/storefronts/headless/bring-your-own-stack)
- [Cart management and private cart IDs](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/manage)
- [Market pricing](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/markets/international-pricing)
- [Customer authentication](https://shopify.dev/docs/api/customer-authentication)
- [Headless B2B](https://shopify.dev/docs/storefronts/headless/bring-your-own-stack/b2b)

- [Shopify checkout authentication](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/checkout-authentication)
- [Hydrogen customer accounts](https://shopify.dev/docs/storefronts/hydrogen/customer-accounts)
- [WorkOS Connect OAuth applications](https://workos.com/docs/authkit/connect/oauth)
- [Clerk Shopify integration](https://clerk.com/docs/guides/development/integrations/platforms/shopify)

## Company purchasing and B2B Markets

Select `commerce-shopify-b2b` with the Shopify Commerce Provider and either supported Auth Provider. It is an alternative to the authenticated B2C add-on; the planner rejects combining them. The internal `commerce-shopify-customer-session` recipe owns the shared OAuth routes and the Auth-specific identity-provider documentation. Recipes install package-owned workflows and thin route/composition files.

The B2B assembly supplies Core's `CommerceBuyerAccounts` through live Customer Account API company-contact locations and uses Commerce B2B's shared buying-context program, company selector and selection action. Company IDs submitted by the browser are selectors only. Membership and customer identity are verified again before purchasing through the Customer Account API. Authorized locations grant the domain `buyer` role. Explicit native role-ID bindings can additionally grant `admin` for invitation management; role display names never authorize. Invitation acceptance uses a separate server-only Admin API credential.

Product and collection queries include the customer's token and selected company-location ID in `@inContext(buyer:...)`. Cart creation and synchronization include the same `companyLocationId` and customer token in `buyerIdentity`. Responses must match the authenticated customer, company location, Store currency and country. Private cart cookies are separated by customer, company location, Store and locale, and changing company resets the client cart state. Each company cart records a token fingerprint so refreshing one cart does not mark other company carts connected to the new token. A stale cart reconnects through the writable refresh route before checkout, preserving its lines. Both Customer Account and Storefront fetches use `no-store`. Company membership and product prices are not stored in public caches.

`/account/login`, `/account/authorize` and `/account/refresh` retain the existing customer-session handoff. Sign-in pages render without constructing a company cart. Buyers with no eligible company locations see the package-owned `/[locale]/company` page. Companies, locations and an administrator can be provisioned initially or created through the included company-registration approval workflow. After that, administrators manage members and invite Buyers from `/[locale]/account`; acceptance provisions the customer/contact and selected location access in Shopify Admin. Company approval provisions the initial company and administrator. Location membership is independent of currency; the switcher lists all locations authorized for the customer. Product and cart reads separately validate returned currencies against the selected Core Store. The initial catalog setup uses `en-US`/USD; additional language/currency contexts need explicit Core Store and Shopify mappings.

Use [catalog B2B setup](catalog/README.md#company-assortments-and-fixed-prices) to provision price-only company Markets; public availability remains controlled by the regional Markets and sales-channel publication. These are provider resources and never become extra entries in the Core Store selector. The [company import guide](../commerce-b2b/catalog/README.md) explains the shared JSON model. Enable the new Markets functionality and native Companies in the Plus sandbox and configure the Headless Customer Account client/identity provider before live verification.

`workspaces/shopify-b2b/next-hydra.json` demonstrates the B2B recipe with Clerk. Refresh with `pnpm --filter create-next-hydra compose shopify-b2b`, require its `--check` to pass, and then run application checks inside that workspace. Unit/native HTTP fixtures cover company access, contextual prices, cart isolation, checkout identity, Market membership changes and migration recovery; they do not replace a purchase against a live Plus sandbox.

## Company member invitations

The `commerce-shopify-b2b` recipe includes the existing Company Registration invitation workflow and the selected Auth Provider's invitation transport. No extra add-on is selected. Its `/[locale]/account` route renders the shared site-authenticated overview; `/[locale]/account/members` renders Commerce B2B's package-owned member and invitation page, and the included API application's `/api/webhooks/clerk` or `/api/webhooks/workos` route delegates signature verification to that Auth Provider. The application runtime composes these Layers; business logic stays in packages. The B2B recipe also installs the reviewer application and new-company registration routes.

Configure `company-invitations.env.example` in the **web application's server environment**, alongside the existing customer-session and selected Auth credentials:

1. Install an Admin API app on the same shop with customer read access and company read/write access (`read_customers`, `read_companies`, `write_companies`), plus any protected customer-data approval required for that app. Configure its [runtime Admin credentials](#runtime-admin-credentials). Keep that app installation stable: its reserved metafield namespaces own the durable records. This token is distinct from the private Storefront token and the Customer Account client ID.
2. Read each native Company's `contactRoles { id name }` and the existing administrator's location role assignment. Set `SHOPIFY_COMPANY_ROLE_BINDINGS` to explicit Company, Buyer-role and administrator-role GIDs. Never infer IDs from names or reuse role IDs from another company. The Buyer role must permit purchasing, and the bound administrator roles must represent the contacts you authorize to invite. No bindings means nobody receives application administrator authority. The server validates the target company's Buyer role before sending/provisioning an invitation.
3. Point the selected Auth Provider's signed webhook to **this web application's** `/api/webhooks/clerk` or `/api/webhooks/workos`. Set the corresponding `CLERK_WEBHOOK_SECRET` or `WORKOS_WEBHOOK_SECRET` in that web application. Clerk uses its existing verified user-created/user-updated invitation evidence; WorkOS uses the existing accepted/revoked invitation events. Reuse the provider's event selection from `auth provision`. The CLI's `--api-url` flag accepts the web application's HTTPS origin for this assembly; publish the generated secret to that application's environment.
4. Keep `NEXT_PUBLIC_WEB_URL` set to the storefront's public HTTPS origin so invitations return to the selected Auth Provider's acceptance flow. The Clerk recipe also installs its `/accept-invitation` route. After acceptance, the buyer completes the existing Shopify Customer Account handoff before company shopping.

For example, using bootstrap credentials and an explicit server-environment destination:

```sh
pnpm --filter cli cli --env-file .env.bootstrap.local auth provision --api-url https://store.example.com --output .env.auth-provisioned.local
```

Load the generated variables from `.env.auth-provisioned.local` into the web application's runtime environment (for local Next.js, merge them into `apps/web/.env.local`). The local output must be a new file. Use local output for this web-only recipe. The existing `auth provision --store vercel` manifest targets the API app, so it must not be used to publish this web webhook's secret; load that secret into the linked web project explicitly. Provisioning is an explicit remote action; composition only installs code.

Issuing, listing, canceling and reissuing an invitation use the current verified company-location context. The form and server procedure both restrict new invitations to Buyer. Existing shared policy enforces administrator authority, location isolation, email matching, expiry, revocation and accepted-identity proof. A submitted company ID or auth metadata alone cannot grant native Shopify access. This slice does not invite administrators/approvers. Member management lists native location members, including people without an application login, and removes configured Buyer access at the selected location. Administrator and custom-role removal stay in Shopify Admin.

On verified acceptance, Core's narrow `CompanyMemberProvisioning` capability is supplied by Shopify. The provider creates a missing customer/contact or links an existing SSO customer, then assigns the configured Buyer role at the invited location and confirms native access before marking the invitation provisioned. It preserves an existing location role. Shopify currently allows a customer to belong to one company with multiple locations; a customer already attached to another company is rejected instead of transferred. Exact email matching locates a customer only after verified invitation acceptance, and private two-way auth-user/customer bindings reject identity conflicts.

Invitation records and identity bindings use separate app-owned Shop metafield namespaces (`$app:company_invitations` and `$app:company_identities`) through the existing Versioned Store interface. They are not catalog metafields and must never receive Storefront or Customer Account public access. Writes use `compareDigest`, unique revisions and tombstones so concurrent updates and deletion/reinsertion cannot silently overwrite newer records. Acceptance retries re-read native customers, contacts and location assignments; a response lost after a native write can be reconciled without deliberately creating a second contact or assignment. Provider failures remain retryable through the signed acceptance flow; native write calls are not automatically replayed.

Automated tests use controlled native HTTP responses, including an assignment committed before its response is lost. They do not prove remote permissions, invitation delivery, consent or Shopify/IdP session continuity. Verify those with one administrator and one invited Buyer in a Shopify Plus sandbox before rollout.

References: [native contact creation](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/companyContactCreate), [existing-customer attachment](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/companyAssignCustomerAsContact), [location role assignment](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/companyContactAssignRole), [metafield ownership and access](https://shopify.dev/docs/apps/build/metafields), and [compare-and-set writes](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/metafieldsSet).

## Company registration and approval

Selecting Shopify B2B automatically includes the company application form, registration API, reviewer application and durable registration workflow, using Clerk or WorkOS. It does not install custom checkout, its delivery API or Stripe. The named `shopify-b2b` workspace demonstrates this assembly without a registration Add-on. The former `commerce-shopify-company-registration` Add-on remains accepted as a compatibility alias and is omitted from new prompts.

The header's sign-up link points to `/register`, and customers without a company location receive a company-application link. Applications record the explicit Core Store selected by the request. Reviewer authentication remains separate from customer sign-in: configure the selected Auth Provider's existing admin application, API reviewer token verification and reviewer permissions as described by that provider. Set the web/API/admin public origins, `REGISTRATION_APPROVER_EMAIL`, and the existing email delivery credentials. The application owns its concrete Layer choices; provider modules implement native company/account operations. The provider-neutral Postgres recipe supplies registration and invitation persistence.

Configure `SHOPIFY_REGISTRATION_ROLES` in the **API application's** server environment. It contains explicit native `buyerRoleId` and non-empty `adminRoleIds` (the first administrator role is assigned to the initial registrant). The adapter checks that those exact IDs exist in the newly created Company's `contactRoles`; it never discovers authority from role names. Read the IDs from the shop before enabling approvals. Use the same installed Admin API app and shop credentials in web and API: their app-owned namespaces must refer to the same records. New-company role bindings are persisted for subsequent shopping, invitations and member management; existing companies can continue using explicit `SHOPIFY_COMPANY_ROLE_BINDINGS`.

This assembly installs the selected signed auth webhook in the **API application** rather than the web application. Configure `/api/webhooks/clerk` or `/api/webhooks/workos` on that API origin and load its signing secret there. The existing `auth provision --api-url https://api.example.com` flow and API-targeted Vercel secret publication apply to this assembly. The B2B-only recipe continues using its web-app webhook. Do not configure duplicate delivery endpoints for the same invitation lifecycle.

An approved application bound to a verified site identity provisions immediately. An anonymous application receives the existing registration invitation; native company creation waits for verified acceptance. Rejection never creates a company. Registration eligibility distinguishes an existing company account from a customer created only by Shopify sign-in, so an unassigned SSO customer can apply and be reused. Email lookup alone does not approve an application or establish its auth identity.

Provisioning creates a native Company and CompanyLocation with the submitted shipping/billing address and optional phone/tax registration ID. It creates or reuses the Customer, links the verified identity and confirms native administrator access. A private creation reservation prevents competing workflow runs from blindly creating duplicate companies. Recovery uses the registration's explicit external ID and the saved reservation, never a company name. If a creation response is lost, retries reconcile an exact native result. An uncertain creation with no provable result fails and requires operator reconciliation rather than repeating the native create call. Definitive native validation rejections with no created company release the reservation for a corrected retry.

Company approval grants membership. **Company pricing assignment remains explicit**. Configure the approval policies below to let the reviewer select them during approval, or retain manual assignment through the existing B2B import bindings or Shopify Admin. The adapter does not guess a pricing group, currency or Market from the registration address or automatically publish a base-price catalog to a new company.

Registration decisions and invitations use the optional Drizzle Effect Postgres adapter from `company-registration`. Set the same `DATABASE_URL` in web and API and apply its checked-in migrations before starting the workflow. `Registrations` combines lookup, listing and lifecycle transitions; `Invitations` retains invitation intent and exact native delivery references. These records are not stored in Shop metafields. Native company provisioning and identity bindings continue using Shopify's private app-owned metadata; SQL does not duplicate native memberships.

Member removal revokes native Buyer role assignments only for the selected location and checks the current roster revision. It preserves access at other locations, the Shopify Customer and their orders. An unassigned customer is retained without claiming they are enrolled for B2C. Auth permissions are updated directly after native membership removal, only when a verified application identity link exists. Failures return to the caller; no removal checkpoints are stored. Native members without such a link remain visible and removable as Buyers; no auth user ID is fabricated. Self-removal, final-administrator protection and incomplete invitation handling remain shared policies. Administrator/custom-role changes must be performed in Shopify Admin in this slice.

Source tests exercise approval and rejection, anonymous invitation acceptance, existing SSO customers, native creation recovery, company isolation, stale rosters and interrupted access removal using controlled HTTP responses. They do not replace testing the installed app's real permissions, webhook delivery, workflow hosting, email delivery and a purchase in a Plus sandbox.

## Company details and addresses

The B2B account navigation links to `/[locale]/account/company`. Commerce B2B owns the page, form, Actions and authorization programs; Core owns `CompanyProfile` and `CompanyProfiles`; each provider supplies its adapter. The existing application runtime and thin route compose them. Buyers can view their selected location's details; only its verified company administrators may save changes. Forms carry a provider revision, never a company selector. Changing the active location invalidates a previous location's revision.

Shopify reads native CompanyLocation details. Saving uses `companyLocationUpdate` with `CompanyLocationUpdateInput` for name/phone, then `companyLocationAssignAddress` for each billing/shipping slot, followed by a fresh read. The parent Company's name is read-only. Both address slots require explicit countries; neither is inferred from locale. This does not expose an arbitrary address collection or personal customer addresses. Native address recipient/contact fields are preserved when editing their street details. Stale forms fail before mutation. Shopify has no conditional location-update argument: the adapter checks fresh state before its writes, but cannot guarantee atomic optimistic concurrency against simultaneous changes made outside the application. A partially completed save, uncertain response or failed final read requires a refresh and is not automatically replayed.

## Approval purchasing policies

In the API environment, optionally set `SHOPIFY_COMPANY_PURCHASING_POLICIES` to a JSON array of provisioned policy bindings:

```json
[
  {
    "key": "gold-earthworks",
    "label": "Gold dealers / Earthworks",
    "storeKey": "default-store",
    "locale": "en-US",
    "currency": "USD",
    "pricingGroupKey": "gold-dealers",
    "pricingMarketId": "gid://shopify/Market/100",
    "pricingCatalogId": "gid://shopify/MarketCatalog/200"
  }
]
```

Replace the example values with explicit Core Store/locale/currency mappings and exact native IDs produced by the existing B2B catalog setup. The policy names the shared pricing group without putting Shopify IDs into the domain decision. The API app additionally needs `read_markets` and `write_markets`. Catalogs and Markets must already be provisioned and active; approval only adds the approved location to their existing membership conditions. It does not import products, create prices or activate Markets.

For Stores with configured choices, the reviewer must select one before approval. The server validates that choice, persists its buying terms with the pending and approved decision, and rejects a changed pairing during retry. After verified onboarding creates the native company/location, the adapter validates the exact price-only Catalog and currency before writing its membership. It preserves other companies' memberships, detects another active B2B Market assignment, follows all company-location connection pages, and verifies the final membership. A response lost after one addition can be reconciled on retry. Initial administrator access is assigned after this step succeeds. Removing an employee does not remove the company's purchasing policy.

An empty configuration explicitly retains manual assignment. No automatic policy is inferred. This configuration does not configure Commercetools; its provider uses native Store bindings described in its own guide. These workflows and native HTTP fixtures run without a sandbox; actual permissions, native updates and shopping still require live verification.

## Explicit purchasing and checkout recipes

New compositions use `recipes: { "commerce.purchasing": ["b2c"], "commerce.checkout": ["hosted"] }` in their workspace definition, or pass `--recipe commerce.purchasing=b2c` during creation. The CLI selects and reports hosted checkout as the sole supported implementation. B2B uses `commerce.purchasing=b2b`; B2C and B2B cannot be selected together in the current integration.

Authenticated B2C remains the `commerce-shopify-customer-accounts` capability with its existing Plus and identity-provider requirements. B2B includes its customer-session integration. B2B includes company registration/approval and its API/Admin applications automatically. The commerce HTTP API remains an independent optional Add-on. Existing Add-on-only definitions and explicit legacy CLI selections retain their previous assembly; new interactive menus ask required recipe choices.

## Promotions

Tax is finalized by Shopify hosted checkout according to the shop's tax settings. The Storefront cart projects Tax as unknown and its total as estimated; the shared cart displays “Calculated at checkout” rather than zero. The adapter does not use Shopify's deprecated Storefront Cart tax fields. Order details continue to display native recorded tax amounts.

Configure Shopify automatic discounts and discount codes in Shopify Admin. The shared `/cart` page and cart flyout display native allocations and support adding/removing codes through `cartDiscountCodesUpdate`; native `applicable` flags remain visible for ineligible codes. Buyer identity and selected Company Location are verified before every change, so B2B availability follows Shopify's configured rules. The hosted checkout receives that same cart and discount state. Runtime calls use the existing private Storefront token; this slice does not create discount rules or require Admin discount-write access.

Product Detail and Product Cards use native price/compare-at pairs. Cards load the minimal prices for all variants (paginating beyond 250) to pair the Product minimum with its own compare-at price. Algolia price replicas sort effective public or pricing-group prices. Re-run search provisioning to install the updated transformation and rebuild sale-price projections; see the search connector README for contextual market price mapping.

### Optional tax provisioning

`commerce data setup --taxes <catalog-tax.json> --tax-config <provider-tax.json>` applies shared Product classifications through this provider. B2B and B2C use the same flags. See [tax setup](../commerce-core/provisioning/README.md#tax-setup) for the command, native capabilities, provisioning scopes and examples in `provisioning/tax-config.example.json`.

### Product links from Shopify

All commerce providers share `/products/[slug]` for Product Detail. Shopify's hosted account, orders and emails link directly to that route. The Shopify recipe normalizes numeric `variant` and `option_values` references into opaque provider IDs before entering Commerce Core, without a redirect or an extra Shopify lookup. Product option-value IDs and native color/image swatches are read with the existing Product query.

The shared picker presents each option separately. Stable option keys support links such as `/products/outdoor-trail-jacket?option.size=L&option.color=BLUE`; display labels can change with locale. A partial option link selects a compatible Variant, retaining the provider default when it matches. An exact valid `variant` reference takes precedence over option parameters. A complete combination that does not exist remains selected with purchasing disabled; a sold-out Variant retains its own price, image and availability. Unknown option keys, values or ambiguous repeated option parameters disable purchasing until corrected.

For native theme links, `option_values` contains one Shopify option-value ID per option. The adapter normalizes those references; Core matches opaque option-value IDs to stable keys. The browser converts a successfully translated native link into shared option parameters using `replaceState`, without navigation. Changing a control updates browser history, and Back/Forward or cached-page restoration resolves the current URL. Country, tracking parameters and hashes are preserved; Store and pricing still derive from the configured locale mapping.

Swatches use Shopify's native option-value swatches when present, with the Product Model's explicit enum-value `swatch` metadata as a fallback. Labels are never interpreted as colors. The same model metadata supplies commercetools swatches. Text controls remain available for values without swatch metadata. The `/products` catalog listing is unchanged.

### B2B registration persistence

Shopify B2B installs the provider-neutral `company-registration-postgres` recipe from `@repo/company-registration`. Registration and invitation data live in Postgres; Shopify still owns companies, company locations and memberships, and the authentication provider owns invitation delivery. Set the same server-only `DATABASE_URL` in the storefront and API environments, then apply the migration before testing registration. See the company-registration package's persistence setup. Shopify B2C does not install this recipe.
