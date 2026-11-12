# Provision a Shopify storefront

Composition installs code and instructions. Provision the external services separately, keeping one receipt for the actual store domain, app installation, Headless storefront/publication, Customer Account client, identity application and published theme. The site key is not the shop's `myshopify.com` domain. Use the recorded resources on continuation and inspect uncertain writes before retrying. Keep bootstrap and runtime secrets in private files outside Git.

## Dependency order

1. Materialize the selected commerce and Clerk/WorkOS assembly. Establish its public HTTPS frontend origin before configuring redirects and callbacks.
2. Create or reconcile the intended development store in the selected Shopify organization. The customer identity-provider recipe requires Plus. Shopify CLI can create dev stores with service-account authentication; it cannot install apps with that service-account token. Use the existing human dashboard login for installation and Shopify-owned settings.
3. [Configure and install the selected Admin app](#admin-app-permissions) on the actual store. Same-organization client credentials or a separately managed Admin token authenticate API operations. Retain the app installation: its identity owns private records and Migrate state. Storefront and Customer Account credentials are separate.
4. Establish the storefront's Clerk/WorkOS application and environment. Create its confidential, first-party OIDC application and save its secret privately. Follow the selected auth package's Shopify customer-account guide.
5. Install/open Headless, reconcile the storefront, enable the documented Storefront permissions and capture its private token. Discover its actual publication ID and the inventory location for import.
6. Create/reconcile the Headless public Customer Account client with PKCE and refresh tokens. Register the exact frontend origin, `/account/authorize` callback and `/account/logout/complete` Logout URI.
7. Connect the OIDC application in Shopify's customer-account identity-provider settings. Register Shopify's callback at Clerk/WorkOS, preserving other callbacks. For WorkOS also register the storefront's `/account/logout/continue` Sign-out URI. Test and activate the connection.
8. Generate runtime configuration with `commerce customer-accounts`, configure the redirect theme, provision Markets, import the selected catalog, configure auth/catalog webhooks, and continue search/CMS and other selected services.

The Customer Account client's frontend callback and the identity provider's Shopify-owned callback are different URLs. The OIDC client secret belongs in Shopify's identity-provider settings, not the storefront runtime.

## Admin app permissions

Keep the app's existing scopes and add Markets access. The Markets dry run needs `read_markets`. Applying the plan needs `write_markets`, which also grants read access. See [catalog setup](../catalog/README.md) for import permissions.

- **Dev Dashboard.** Create a new version of the app, update its Admin API scopes, and release it.
- **Shopify CLI app.** Update `[access_scopes].scopes` in `shopify.app.toml` and run `shopify app deploy` from the app directory.

Install the app on the intended store, or open its existing installation and approve the updated permissions there. Rerun the Markets dry run below with that store's private Admin credentials. See [Shopify's access scope guide](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes).

## Existing deterministic commands

Run from the workspace root with absolute private paths. Check installed help for the selected command's supported flags and destination:

```sh
pnpm --filter cli cli --env-file /private/admin.env commerce project provision --dry-run
pnpm --filter cli cli --env-file /private/admin.env commerce project provision
pnpm --filter cli cli --env-file /private/admin.env commerce customer-accounts \
  --client-id '<Headless Customer Account client ID>' \
  --origin https://frontend.example.com --output /private/customer-accounts.env --yes
pnpm --filter cli cli --env-file /private/import.env commerce data setup \
  --directory /private/catalog --state-directory /private/migrate --plan
```

For B2B pass the validated Shopify pricing-group bindings using `--bindings`. Apply the same source and Migrate state after reviewing the plan. The data plan traverses local inputs; it does not contact Shopify or prove destination readiness. Keep base currency, primary locale, tax/shipping settings and the Headless publication consistent with the input profile. No commercetools Heavy Machinery conversion or sample cleanup applies to Shopify.

Clerk's `auth oauth provision` creates/reconciles its OAuth application and adds Shopify's callback using the original private credential receipt. See `packages/auth-clerk/docs/shopify-customer-accounts.md`. WorkOS Connect can be configured through its supported APIs or saved dashboard session; see `packages/auth-workos/docs/shopify-customer-accounts.md`. Neither the customer-account configuration command nor the Admin app activates Shopify's identity-provider connection.

## Redirect theme

Use the operator's redirect theme when specified. Otherwise obtain Shopify's official `https://github.com/Shopify/hydrogen-redirect-theme`, pin its revision and retain that checkout for retries. The theme must expose its documented `storefront_hostname` setting. Prepare a separate copy without changing source:

```sh
pnpm --filter cli cli commerce redirect-theme prepare \
  --source /absolute/redirect-theme-source --output /absolute/configured-theme \
  --origin https://frontend.example.com --dry-run
pnpm --filter cli cli commerce redirect-theme prepare \
  --source /absolute/redirect-theme-source --output /absolute/configured-theme \
  --origin https://frontend.example.com
```

This sets only the storefront hostname, preserving custom redirects, account integration settings and the theme's checkpoint/discount handling. It records source/output digests and refuses to silently overwrite a changed copy or different source. Theme preparation acquires no credentials and publishes nothing. Use Shopify CLI `theme push` and `theme publish` with the recorded store and theme ID; pass its credentials through the private environment, not arguments. On a retry inspect `theme list` and the recorded ID before adding another theme.

## Verify completion

Check real Storefront product visibility, prices/inventory, company context when selected, and theme redirects with paths/query parameters. Verify fresh login, an already signed-in Clerk/WorkOS shopper, logout and refresh against the actual services. Confirm the cart/checkout receives the expected Shopify customer. Configure shipping and test payment methods for requested checkout tests. Report native account/plan restrictions and any unverified dependency; runtime ENV publication alone does not establish end-to-end authentication.
