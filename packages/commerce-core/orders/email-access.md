# Email Order access

Commerce installs a guest Order detail page independently of signed-in account history and the optional order workflow. A privileged sender issues a link for one personal Order, its original Store and its recorded recipient. No public operation accepts an email address as proof of ownership. Company Orders continue to require authenticated membership and permission.

Set `NEXT_PUBLIC_WEB_URL` to the storefront origin and `COMMERCE_ORDER_ACCESS_SECRET` to a private 32-byte base64url key in the web application's environment. Generate the key once and retain it across deployments:

```sh
node -p "require('node:crypto').randomBytes(32).toString('base64url')"
```

Links are authenticated encrypted tokens: their URLs do not expose the email address. They have no time expiry. Changing the Order's email or Store invalidates that Order's existing links; rotating the secret invalidates all links issued with the previous secret. Anyone possessing a link can read that one Order, including a recipient who forwards it. There is no public token-renewal or email-lookup endpoint.

The emailed URL is `/<locale>/orders/<encoded-order-id>/access?token=...`. The package-owned handler validates the token, installs a separate HTTP-only cookie named `commerce-order-access.<encoded-order-id>` for each Order, then redirects to `/<locale>/orders/<encoded-order-id>` without the query. Cookies use the storefront root path so changing locale keeps access and opening another Order link does not replace the first Order's credential. The entry response is private, uncached and uses `Referrer-Policy: no-referrer`. Detail pages are dynamic and excluded from indexing. Each read verifies the credential and checks native recipient, personal purchasing context and Store attribution again. A link cannot open another Order or supply an order-history listing.

With `commerce-order-workflow`, personal order confirmation and shipment notices include a View your order link. The workflow saves the exact URL with the pending email before delivery, preserving the email payload across retries and Resend deduplication. Configure the secret before enabling these personal order notifications. Company emails do not issue guest credentials or require this secret.

Custom senders can call the `OrderAccessLinks` Effect service using `orderAccessLinksLayer` from `lib/orders/access-links`. Obtain the recipient and Store from the native Order, issue the link with `EmailOrderAccess`, and deliver it only to that recorded address. Persist the URL before an idempotent email send, as the supplied workflow does.

Shopify's native notification templates remain platform-owned and use their existing links. Selecting a Shopify custom order workflow adds these application emails; coordinate native notifications as described in the [workflow guide](README.md). Reading guest details through our page requires Shopify Admin order and protected recipient access, just like our custom sender; Customer Account sign-in is unnecessary. The commercetools reader uses privileged Order reads. No guest token grants access to provider administration or account sessions.
