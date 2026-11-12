# Authentication and application permissions

`@repo/auth-contract/permissions` defines a request-bound Effect capability:

```ts
const allowed =
  yield *
  Permissions.pipe(
    Effect.flatMap((permissions) => permissions.has("company.members.invite"))
  );
```

Compose `Permissions.layer(context)` for a verified auth user and resource scope. Its Effect requirement is `PermissionAdapter`, so the host selects a concrete adapter through `Layer.provide`. A Business Unit or auth Organization can be a scope; the contract does not require either. The host derives this context from verified identity and resource access before supplying the Layer. Adapters can be shared; the selected user and scope belong to the request. `Permissions.layerWith(context, adapter)` is the equivalent convenience constructor for an already-built adapter value.

The `PermissionAdapter` service implements `has(context, permission)` with an Effect returning a boolean or `PermissionCheckFailure`. `PermissionAdapterValue` describes that implementation. Adapters acquire their clients and other dependencies during their own Layer construction. They can check a permission directly or use `permissionAdapterFromGrants(resolve)` to resolve a normalized `PermissionGrant` for only the requested context. Grant resolution happens when the check executes. No grants are loaded when the Layer is constructed, and the generic capability adds no cross-request cache.

The grant adapter verifies that the returned user, scope type and scope ID match the requested context. Missing grants and absent permission names return `false`; lookup failures and mismatched grants remain typed failures. Permission names match exactly, with no role-name conversion, wildcard expansion or implied privileges. `Permissions.layerNone` explicitly supplies no authority for anonymous or restricted contexts.

Auth provider adapters can normalize server-managed user metadata or verified custom token claims into these grants. They own provider encoding, runtime decoding, subject verification, token validation, refresh behavior and any caching. The claim reader must use backend-controlled metadata; a client-writable metadata field is not an authority source. The same capability can authorize server actions and HTTP handlers. UI flags only describe the resulting available actions.

`PermissionGrants` defines the versioned user-level document for metadata or custom claims. Each entry contains a scope and an exact permission list; the containing verified session/token establishes the user identity. `permissionGrantFromDocument(context, document)` decodes this object or its JSON string representation and returns the grant for the exact scope, with the verified user identity attached. Missing documents deny; malformed documents and duplicate grants for the selected scope fail with `invalidGrant`.

WorkOS and Clerk supply selectable organization and metadata adapters, documented in [WorkOS](../auth-workos/README.md) and [Clerk](../auth-clerk/README.md). Both implement the same `PermissionAdapter` Effect service. B2B invitation, membership-removal and profile-editing flows now use typed feature checks against company-scoped metadata grants. Admin registration review uses typed checks against the verified active organization. `organizationPermissionsLayer(snapshot)` bridges an already verified `AuthSession` or `VerifiedAccessToken` native permission checker into `Permissions`; an absent identity or organization denies. Company onboarding initializes company-scoped grants from the existing registration/invitation presets: administrators receive the company management actions, while other roles receive no management grant by default. An existing explicit grant is preserved on retry. Membership removal revokes only the removed company scope. Token-template provisioning remains a separate setup step.

## Typed permission definitions

Features own readonly literal arrays of supported permission names. `defineAuthorization(...featureDefinitions)` infers their combined union, exposes a deduplicated readonly `permissions` list, and provides a typed `has(permission)` check. The check returns an Effect requiring the existing `Permissions` service; it does not introduce another service or choose an adapter. Unknown runtime input denies before consulting the adapter. An empty manifest accepts no permission names (`never`).

```ts
const memberPermissions = [
  "company.members.invite",
  "company.members.remove",
] as const;
const authorization = defineAuthorization(memberPermissions);
const allowed = authorization.has("company.members.invite");
```

Feature programs use their own definitions and typed helper. Recipes combine installed definitions into `@repo/auth-contract/permissions/storefront` and `@repo/auth-contract/permissions/admin`. The provider-facing `Permissions` service continues to accept strings and remains independent of the installed feature vocabulary.

Definitions declare actions, not grants, default access or resource ownership. Installing a feature does not grant anyone its permissions or change its existing enforcement rules. Storefront and Admin use independent manifests and must supply their respective verified identity realms and scopes.

## Recipe composition

The manifests live in this package at `permissions/storefront.ts` and `permissions/admin.ts`. Each exports `authorization.has(permission)`, the composed readonly list (`storefrontPermissions` or `adminPermissions`), and its inferred union (`StorefrontPermission` or `AdminPermission`). The source checkout contains empty authoring defaults; composition renders the selected literal permission names into those modules.

```ts
import { authorization } from "@repo/auth-contract/permissions/storefront";

// Available when the company member feature is installed.
const allowed = authorization.has("company.members.invite");
```

Definitions remain in `commerce-b2b/permissions`, `commerce-b2c/permissions`, and `company-registration/permissions`. B2B and B2C recipes bind their definition arrays directly to the storefront manifest. A combined storefront receives both. The commerce Admin recipe binds registration review definitions only to the Admin manifest. Installing company registration in the storefront does not expose its review actions there. Without commerce, both manifests are empty.

The templates use a `string-array` slot. Its binding specifies a workspace-relative TypeScript source module and directly exported constant array:

```json
{
  "target": "packages/auth-contract/permissions/storefront.ts",
  "slot": "permissions",
  "module": "packages/commerce-b2b/permissions.ts",
  "export": "companyPermissions"
}
```

Composition reads literal strings, local constant references and array spreads without importing or executing the feature module. It rejects dynamic expressions, imported values and malformed definitions. Selected names are deduplicated and emitted as a readonly literal array; generated manifests import only the core helper. Definitions use the same selected registry file content as installation, looked up by workspace target. Published bindings cannot read unrelated checkout files. Canonical bindings may also use source-only definition files, captured as inputs for freshness checks; edits require workspace refresh.

`auth-contract` has no dependency on the feature packages, and the feature packages can continue depending on it. Clerk and WorkOS implement permission resolution through their adapters; neither owns manifest data or flavor selection. No new package, provider-specific manifest recipe, or circular package dependency is required.

Typed definitions capture no user, company, role or grants. Runtime checks bind verified request identity and scope. Customer ownership, commerce membership and native invariants remain separate checks; a manifest does not enforce identity-realm isolation or resource access itself. Native roles still describe provider assignments. Company actions use permissions, self-removal is forbidden, and the acting manager must remain a verified member; provider-specific membership restrictions still apply.
