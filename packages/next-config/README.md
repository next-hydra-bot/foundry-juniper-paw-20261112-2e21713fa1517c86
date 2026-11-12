# Shared Next.js configuration

## Cache revalidation

The web baseline owns one `/api/revalidate` route for all cache invalidation, including CMS callbacks and commerce backend events. It is bound to Next.js cache operations through `@repo/next-config/revalidation`. Callers translate their own events into cache tags and paths; the endpoint has no CMS or commerce knowledge.

Set `REVALIDATION_SECRET` in web to at least 32 random characters. Use the same value in trusted callers. For the commercetools catalog handoff, bind API to web as `WEB_INTERNAL_URL` on Vercel Services or set `REVALIDATION_ENDPOINT=https://web.example.com/api/revalidate` in API for separate deployments.

Send authenticated JSON:

```http
POST /api/revalidate
Authorization: Bearer <REVALIDATION_SECRET>
Content-Type: application/json

{
  "tags": ["commerce:product-lists", "node:123"],
  "paths": ["/en/products", { "path": "/products/[slug]", "type": "page" }]
}
```

Either list may be omitted, but at least one valid tag or path is required. Concrete paths are strings. Route patterns require `{ "path": "...", "type": "page" | "layout" }`; a layout request can also target a concrete path. Each list accepts at most 32 entries. Tags retain their exact case and may contain up to 256 characters; paths must be local pathnames without query strings or fragments and may contain up to 1024 characters.

The route validates the complete request before invalidating anything. Tags expire immediately with `revalidateTag(tag, { expire: 0 })`; path revalidation takes effect on the next visit. Invalid input returns `400`, invalid authorization `401`, and an unconfigured secret `503`.

Drupal's native callback uses the same endpoint with `GET /api/revalidate?secret=<REVALIDATION_SECRET>&tags=node:123,node_list`. GET also accepts comma-separated `paths` for concrete paths. Backend integrations should use POST with the bearer header. The Drupal installer prints `REVALIDATION_SECRET` for the matching web environment.
