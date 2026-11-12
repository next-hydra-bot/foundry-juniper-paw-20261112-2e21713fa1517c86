# Shopify Plus customer accounts with Clerk

The Shopify customer-accounts add-on selects this recipe automatically when Clerk is the Auth Provider. The shared Shopify implementation reads `authSessionAdapterLayer` from `@repo/auth/server`; Clerk supplies the site user, session ID and primary email. No Clerk token is exchanged directly for a Shopify customer token.

Use the same Clerk application and environment that authenticates the storefront, with its customer `CLERK_SECRET_KEY` in a private bootstrap file. Do not use the separate Admin application's credentials.

From the materialized workspace root, create the confidential OAuth application through Clerk's Backend API:

```sh
pnpm --silent --filter cli cli \
  --env-file "$PWD/.env.bootstrap.local" \
  auth oauth provision \
  --name "Storefront customer sign-in" \
  --output "$PWD/.env.shopify-oidc.local" \
  --yes
```

The command enables `openid email profile`, disables the first-party consent screen, and saves the one-time client secret in a mode-0600 file. It prints only the client ID and discovery URL. Retain the file: reruns use its exact application and instance IDs, preserve existing callback URLs and reuse its secret. A matching name alone never selects an existing application. Add `--dry-run` to inspect the plan without creating or updating anything.

The explicit `--env-file` is required when your key is only in the workspace-root bootstrap file: the CLI otherwise reads `apps/cli/.env` and the shell. pnpm runs this command inside `apps/cli`, so use absolute environment and output paths as above. Missing or empty `CLERK_SECRET_KEY`, unreadable environment files and unavailable output directories fail before any Clerk API request. Configuration validation runs before the confirmation prompt.

In Shopify Plus, enable customer accounts and open **Settings → Customer accounts → Identity provider → Manage → Connect to provider**. Supply the discovery URL and client ID printed by the command and the client secret from the private file. Set **Additional scopes** to `profile` and **Post-logout redirect URI parameter name** to `returnTo`. Shopify's identity-provider connection and activation remain dashboard steps; the command does not activate them through the Admin API.

Copy Shopify's **Callback URL** and register it with the same Clerk application by rerunning the command with the same output file:

```sh
pnpm --silent --filter cli cli \
  --env-file "$PWD/.env.bootstrap.local" \
  auth oauth provision \
  --output "$PWD/.env.shopify-oidc.local" \
  --redirect-uri "<exact HTTPS callback supplied by Shopify>" \
  --yes
```

Save and activate the provider in Shopify after registering the callback. Clerk hosts the discovery, authorization and token endpoints; no additional identity-provider endpoints belong in the storefront. The private OAuth file is an ownership receipt and secret handoff to Shopify, not a web runtime environment file. Do not copy its OAuth client secret into the storefront.

Complete the separate Shopify Headless Customer Account API client and runtime environment setup using [`commerce customer-accounts`](../../commerce-shopify/README.md#shopify-plus-customer-accounts). Its `/account/authorize` callback belongs to the storefront. Shopify's callback registered in Clerk belongs to Shopify. The first Clerk command does not need a storefront origin, so it can run before configuring local HTTPS. Shopify excludes localhost callbacks; for a Portless application, use an HTTPS tunnel origin for the Headless callback, the runtime configuration, and the entire browser session. Keep the web origin, Clerk authorized party and Shopify storefront origin aligned as described in the provider guide.

The storefront uses Clerk's hosted sign-in and does not collect customer passwords. It can receive the authenticated user's email and other profile data. The browser handoff is storefront → Shopify Customer Accounts → Clerk → Shopify → storefront. Hydrogen exchanges a **Shopify authorization code** with PKCE for Shopify access and refresh tokens. The ordinary Clerk access token is not exchanged directly for Shopify tokens. Shopify tokens are reused and refreshed; missing or unusable Shopify sessions and replaced site sessions can require the handoff again.

On first connection, the authenticated site email and Shopify customer email must match before the provider creates a private site-user-ID/Shopify-customer-ID association. Configure verified email at the identity provider. Later handoffs validate those IDs independently of email changes and reject attempts to rebind an existing association. Encrypted cookies bind the Shopify session to the current Clerk user and session, and the cart receives the Shopify customer token for checkout. Persisting the identity association requires runtime Shopify Admin credentials from the same installed app used by company identity storage; see [the provider's prerequisites](../../commerce-shopify/README.md#shopify-plus-customer-accounts). This also applies to authenticated B2C without company registration.

The browser customer-account recipe adds a preparation action to the storefront's Sign out control. It captures Shopify logout while the original Clerk session is still available, clears Shopify cart/customer credentials, then signs out that exact Clerk session and continues through Shopify logout. Its Clerk completion callback uses a full browser navigation: a Next.js router fetch cannot complete the external logout redirect and must not consume the one-use continuation. Register the provider guide's `/account/logout/complete` URL as the Headless client's Logout URI. An account changed during preparation is not signed out as the previous user. Admin and API-only storefront sign-out retain their ordinary Clerk behavior. Direct custom calls to Clerk sign-out bypass this composed commerce preparation.

Verify the handoff with an already signed-in shopper, a fresh browser, sign-out, session replacement and token refresh against the configured services. Existing Clerk sign-in must satisfy Shopify's identity-provider authorization without another credential prompt to meet the storefront's session-continuity requirement. The composition and local tests do not establish that remote behavior or bypass any consent required by the configured OAuth application. This flow does not promise global Shop Pay logout or revocation of an already-open checkout.

Setup follows [Clerk's Shopify integration guide](https://clerk.com/docs/guides/development/integrations/platforms/shopify), [Clerk's OAuth application API](https://clerk.com/docs/reference/backend/oauth-applications/create), and [Shopify's Headless client setup](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started#step-2-configure-customer-account-api-access).
