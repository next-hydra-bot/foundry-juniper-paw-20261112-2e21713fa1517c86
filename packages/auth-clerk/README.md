# Clerk application permissions

Provider-neutral typed manifests live in `auth-contract`, with definitions owned by domain packages. See [typed definitions and recipe composition](../auth-contract/README.md#typed-permission-definitions).

Clerk implements the same `PermissionAdapter` Effect service as WorkOS. An application explicitly selects `source: "organization"` or `source: "metadata"`. The sources never supplement each other or fall back to one another.

```ts
import { Permissions } from "@repo/auth-contract/permissions";
import { permissionAdapterLayer } from "@repo/auth-clerk/permissions";
import { clerkPermissionSessionLayer } from "@repo/auth-clerk/permissions-server";
import { Layer } from "effect";

const permissionsLayer = Permissions.layer(context).pipe(
  Layer.provide(
    permissionAdapterLayer({ source: "metadata" }).pipe(
      Layer.provide(clerkPermissionSessionLayer)
    )
  )
);
```

Construct `context` on the server from the verified auth user and selected resource. The caller uses `permissions.has("company.members.invite")` regardless of provider or authority source. UI controls can reflect that result, but the server operation must enforce it.

## Organization source

Use `permissionAdapterLayer({ source: "organization" })` for applications that use Clerk Organizations, such as merchant administration. The context must have `scope.type: "organization"` and the exact active organization ID. The adapter maps `resource.action` to `org:resource:action` and delegates to the authenticated SDK's `has` method. It retains Clerk's native custom-permission and feature checks rather than interpreting role names or expanding compact JWT permission data itself. Clerk's server permission checks support custom permissions; system permissions are a separate concern. See [Clerk authorization checks](https://clerk.com/docs/nextjs/guides/secure/authorization-checks).

Supply a complete explicit mapping for domain names that do not fit the two-part convention:

```ts
permissionAdapterLayer({
  permissionMap: new Map([
    ["company.members.invite", "org:members:invite"],
    ["company.orders.viewAll", "org:orders:view_all"],
  ]),
  source: "organization",
});
```

When a mapping is supplied, unmapped permissions deny. Permission mappings translate action names; they do not contain company memberships or roles.

## Metadata source without Organizations

Store this versioned object in the user's server-managed `publicMetadata.application_permissions` field:

```json
{
  "grants": [
    {
      "permissions": ["company.members.invite", "company.orders.viewAll"],
      "scope": { "id": "warehouse-east", "type": "business-unit" }
    }
  ],
  "version": 1
}
```

Configure the Clerk session token's custom claims in the Dashboard:

```json
{
  "app_permissions": "{{user.public_metadata.application_permissions}}"
}
```

Select `permissionAdapterLayer({ source: "metadata" })`. No active Organization or organization subscription is needed by this adapter. Permission names and scope IDs match exactly, with no wildcard expansion or role inference. Metadata may be an object or JSON string, matching WorkOS's shared grant format. Missing grants deny; malformed grants, duplicate entries for the selected scope and subject mismatches produce typed failures.

`publicMetadata` is readable by the client and writable only through backend APIs. Grant data must not contain secrets. Never use client-writable `unsafeMetadata` as authority. The containing verified session establishes the user ID; a metadata document cannot choose another user. See [Clerk user metadata](https://clerk.com/docs/guides/users/extending).

## Session lifecycle and integration status

`clerkPermissionSessionLayer` calls Clerk's server `auth()` when each permission check executes. It requires an authenticated session, verifies the claims' subject against the SDK user, and uses the SDK's normalized active organization and native checker. Anonymous or pending sessions grant no authority. SDK read/check errors become `PermissionCheckFailure`. The shared adapter Layer does not capture a shopper at construction or cache grants across requests. Tests and other authenticated transports can supply `ClerkPermissionSession` or the injected `clerkPermissionSessionLayerWith` reader.

Permissions reflect the signed token snapshot. Backend metadata edits take effect when that token refreshes; sensitive revocation flows must account for that delay. Clerk documents an 8 KB metadata limit and approximately 1.2 KB for custom session claims, so avoid growing this document into an unbounded membership directory. Larger grants need a backend lookup strategy. See [session token customization](https://clerk.com/docs/guides/sessions/customize-session-tokens).

`storefrontPermissionAdapterLayer` supplies the metadata adapter with the verified Clerk request session. B2B account-management flows bind it to the selected Business Unit. Admin registration review uses typed checks over the SDK native organization checker; web sessions and verified bearer tokens retain the active organization ID. Missing active organization denies Admin access. Company onboarding initializes company-scoped management grants for the administrator preset, preserves explicit grants on retry, and revokes only the removed company scope. Token-template provisioning and live configuration verification remain separate setup steps. Customer Organizations are not required, and the Shopify SSO flow is unchanged.

## Provisioning webhooks and Admin configuration

Complete this section when company registration/approval is selected. That composition includes `apps/admin`, `apps/api` and the customer webhook route. Existing-company storefronts can use their package-owned web invitation webhook without these applications.

Create a separate Clerk application for `apps/admin` with its own credentials and host-only cookies. Do not configure the admin host as a satellite of the customer application. The API uses the admin application's `ADMIN_CLERK_*` credentials and `ADMIN_CLERK_AUTHORIZED_PARTIES` to verify reviewer access.

From the project root, register the customer webhook using the customer `CLERK_SECRET_KEY`:

```sh
pnpm --filter cli cli auth provision \
  --api-url <public-api-url> --output auth.env
```

Replace the placeholder before running the command. Relative output paths resolve in `apps/cli`. Configure the returned signing secret in the API application's environment. The endpoint is create-only; an exact managed endpoint can be read on rerun to recover its secret.

For Vercel publication use `--store vercel` and repeat `--environment` for the required deployment environments. The command checks the linked API project and publishes the webhook signing secret there. Existing variables require explicit `--overwrite`; redeploy after publication.

## Scoped company roles

B2B recipes select `storefrontRoleAssignmentsLayer` and the Commerce B2B role policy instead of the explicit-grants adapter. Server-managed `application_roles` contains `{ "version": 1, "scopes": { "business-unit": { "unit-a": ["admin", "buyer"], "unit-b": ["buyer"] } } }`. Expose it as the verified `app_roles` session claim. In the B2B customer session template, replace the previous `app_permissions` claim rather than copying both documents into the token. The role source reads only the requested user's selected scope; native Organization permission checks and the separate Admin application remain independent. Company onboarding/member operations use the same writer as subscription synchronization.

Clerk custom session claims: `{"app_roles":"{{user.public_metadata.application_roles}}"}`. Only the role document goes into the token. The writer enforces a 900-byte budget; account for other custom claims separately.

### Provision storefront session claims

Sign in once with Clerk's account CLI, then run the workspace command:

```sh
npx clerk@4.1.0 auth login
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" \
  auth claims provision --dry-run
pnpm --filter cli cli --env-file "$PWD/.env.bootstrap.local" \
  auth claims provision --yes
```

The env file supplies the existing customer `CLERK_SECRET_KEY`. That key identifies the exact instance; the authenticated Clerk CLI locates its owning application and configures `session.claims`. No additional Platform key or Application ID is required. The command uses the pinned Clerk CLI through `npx`, which must be available on the provisioning machine; the Clerk CLI owns its login credentials and refreshes.

B2B recipes select the scoped-role claim definition from Auth Contract. The command adds `app_roles`, removes the superseded B2B `app_permissions` claim, preserves unrelated claims and session settings, and verifies the result. A dry run validates the patch with Clerk and checks that current claims remain unchanged. Identical reruns do not write. B2C without additional claim definitions has nothing to provision and requires no account login for this command.

The input env file is not modified and this command produces no credential output file. `ADMIN_CLERK_SECRET_KEY` is never used as a fallback. The command targets only the instance identified by the customer key, independently of any application selected in Clerk's CLI. Existing shopper tokens need a refresh before the new claim appears.

Role changes reach existing tokens on refresh. Larger role sets need a backend role source. See [company synchronization](../commerce-commercetools/company/identity-sync.md) for initial reconciliation, event handling and native membership verification.
