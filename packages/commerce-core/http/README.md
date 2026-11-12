# Optional commerce HTTP API

Select `commerce-commercetools-api` or `commerce-shopify-api` to install the selected provider's API at `/api/commerce`, including `/openapi.json`. The Order read endpoints are part of that API add-on. They run independently of `commerce-order-workflow` and application email delivery; onboarding and Admin continue to follow the selected buying recipe. The existing complete commercetools backend assembly also mounts these operations at its API origin.

Core owns the HTTP schemas and public errors. The selected buying recipe supplies the B2C or B2B Order programs; the provider supplies verified buyer context and its `OrderQueries` implementation. B2C reads the signed-in Customer's personal Orders. B2B reads the selected Business Unit's shared Orders after verifying membership independently of shopping Store eligibility and checking `company.orders.read`. The request cannot supply a Customer ID or change the installed buying flavor.

## Order requests

Both endpoints require a verified site bearer token and `X-Context-Locale`. Supply `X-Context-Purchasing-Context: personal` for B2C, or `company` plus `X-Context-Business-Unit-Id` for B2B. Shopify also requires `X-Shopify-Customer-Token`; its middleware validates the linked site and Shopify identities and company membership. See the provider's HTTP setup instructions for credentials and scopes.

| Method | Path | Response |
| --- | --- | --- |
| GET | `/orders?allStores=true` | `OrderPage`: `items`, optional `nextCursor` and `historyLimitDays` |
| GET | `/orders/:id?storeKey=...` | `OrderDetail` |

Every request explicitly selects **exactly one** of `allStores=true` or `storeKey=<opaque Store key>`. Neither omission nor `allStores=false` is accepted. This historical selection is independent of the locale-derived shopping Store. Locale affects presentation; each Order retains its recorded currency. Orders lacking Store attribution can appear in all-Store history, never in a single-Store result.

Listing accepts these additional query parameters, combined with AND:

| Parameter | Meaning |
| --- | --- |
| `limit` | Page size 1–100, default 20 |
| `after` | Opaque `nextCursor` from the preceding response |
| `number` | Exact Order number |
| `purchaseOrderNumber` | Exact purchase-order number |
| `createdFrom` | Inclusive UTC timestamp |
| `createdBefore` | Exclusive UTC timestamp; must be later than `createdFrom` |
| `payment`, `fulfillment`, `cancellation` | Independent domain status values, enumerated by OpenAPI |

For example, `GET /api/commerce/orders?allStores=true&limit=20&payment=paid&createdFrom=2026-10-01T00:00:00Z`. Pass the same filters, Store selection, locale and buyer context when following `nextCursor`; restart pagination after changing them. A bounded provider scan can return an empty page with a cursor, so continue until `nextCursor` is absent. There is no exact total.

Pass an Order's opaque `id` back unchanged, URL-encoded once as a path segment. Do not substitute its display number or parse provider ID formats.

Order reads do not load, mutate or synchronize carts and do not return cart credentials. Responses are private and not cacheable. Email-authorized guest links grant access only through the dedicated Order-page flow; they cannot authorize HTTP history or substitute for these credentials.

## Company permissions

The selected Auth Provider verifies the site token. For B2B, the HTTP adapter reads the signed `app_roles` claim and evaluates the installed company permission policy for the selected Business Unit. For example:

```json
{
  "version": 1,
  "scopes": {
    "business-unit": { "<selected Business Unit ID>": ["buyer"] }
  }
}
```

Configure the Auth Provider's metadata-to-claim projection and refresh the bearer token after changing roles. A role must grant `company.orders.read` for that verified subject and exact selected Business Unit. Missing roles deny access. Malformed assignments fail closed. No paid Auth Provider organization or browser cookie is needed. Admin uses its separate identity and authorization configuration.

## Failures

Invalid query parameters or mismatched cursors return 400. Missing/invalid identity returns 401; an unauthorized company or missing company permission returns 403. Missing and inaccessible Order IDs return the same 404 response. Temporary provider failures return 503; configuration or malformed native data returns a sanitized 500. Public errors never contain provider payloads, tokens or internal diagnostics.

## Cart discount codes

`PATCH /api/commerce/cart/discount-codes` accepts `{ "action": "add", "code": "WELCOME" }` or `"action": "remove"` and returns fresh `CartPublicState`, with the same buyer headers and Cart credentials as other Cart mutations. Requests cannot choose a Customer or Cart ID. Applied codes expose `applicable`; a false value means no eligible discount currently applies. Rejected codes return the standard mutation failure. Native automatic offers and allocations are returned in `cart.discounts`, while `subtotalPrice` is merchandise before Cart discounts and `totalPrice` is the native payable total. No additional API add-on is needed beyond the existing provider Commerce API recipe.

## Address book

`makeAddressBookApiGroup` and `addressBookHttpPrograms.list` describe the authenticated `GET /address-book` operation and project domain read failures to public HTTP errors. Hosts supply verified customer/company context and the provider Address Book layer. The commercetools commerce API recipe mounts it at `/api/commerce/address-book`. It accepts the buying context selected by the recipe. The endpoint works independently of company registration and checkout.
