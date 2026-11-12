# @repo/cms-contentstack

Contentstack implementation of the Next Hydra CMS interface.

Applications consume this package through the stable `@repo/cms` dependency name. With pnpm, select this implementation in the consuming application's `package.json`:

```json
{
  "dependencies": {
    "@repo/cms": "workspace:@repo/cms-contentstack@*"
  }
}
```

Application code should import only the supported `@repo/cms/*` entry points declared in this package's export map. It should not import `@repo/cms-contentstack` directly. This keeps the provider choice at the application composition root.

Contentstack-specific GraphQL, generated types, environment keys, preview behavior, and image configuration remain owned by this package.

`@repo/cms/security` exports `cmsFrameAncestors`, a list of editor origins for the web application's Nosecone framing policy. Contentstack resolves its editor origin from `CONTENTSTACK_REGION` using the SDK's endpoint catalogue. The web application adds same-origin framing. The existing CMS proxy continues to handle preview redirects and request context.

## Site announcement

**Announcement** is a multiple-entry content type. Editors can create separate announcements with their own message, link label, URL, and enabled flag. The starter recipe seeds a Next Hydra demo notice linking to `https://next-hydra.dev`. Published content uses locale fallback and the `announcement` cache tag; Live Preview reads draft content without the published cache.

The current site integration renders the first returned announcement above the header. Explicit placement references and page-type or audience selection are not wired yet; enabling multiple entries does not implement those selection rules.

Existing stacks need the `announcement` content type and an entry from the recipe before deploying this layout. The baseline import is intended for empty stacks; do not reimport the full recipe over an existing stack to add this model.

## Provision a stack

The command provisions an existing, empty Contentstack stack. Pass a private dotenv file with `CONTENTSTACK_STACK_API_KEY`, `CONTENTSTACK_REGION`, and `CONTENTSTACK_MANAGEMENT_TOKEN` via the workspace CLI's `--env-file` flag. Set `--management-token-alias` to `stack-<stack-api-key>`. The command configures the pinned Contentstack CLI for the region and registers that alias. An existing CSDX Management Token alias also works:

```bash
pnpm --filter @repo/cms-contentstack exec csdx auth:tokens:add \
  --alias my-stack \
  --management
```

Then run the provider-neutral workspace command from the installed workspace root. pnpm runs it in `apps/cli`, so the relative output path below writes `apps/cli/.env.contentstack.local`:

```bash
pnpm --filter cli cli cms provision \
  --management-token-alias my-stack \
  --production-url https://store.example.com \
  --output .env.contentstack.local
```

The command verifies the pinned Contentstack CLI, resolves the target Stack API Key from the alias, reads the region already configured in `csdx`, and imports the checked-in recipe. The recipe creates the baseline `landing_page`, `navigation`, `announcement`, and administrative `migrations` content types, English starter entries, and the `development` and `production` environments. Provisioning then applies every pending migration before collecting runtime credentials. With `--production-url`, provision sets the locale base URLs for the environment the web app actually reads. Runtime credentials target `development` by default. Select another environment with `--contentstack-environment`. Omit `--production-url` if the hosted origin is pending and set it later with `cms preview`.

The target stack master locale defaults to `en-us`. If the stack uses another master locale, declare it so the materialized import includes English as an additional locale instead of silently skipping the starter entries:

```bash
pnpm --filter cli cli cms provision \
  --management-token-alias my-stack \
  --stack-master-locale fr-fr \
  --production-url https://store.example.com \
  --output .env.contentstack.local
```

After import, Foundry can create Delivery and Preview Tokens through its configured OAuth grant and hand them to the running command. For a direct CLI run, provide both tokens through `--env-file` or enter them at the masked prompts. The command verifies that the application's GraphQL query returns a published homepage before writing runtime credentials. Set `CMS_HOMEPAGE_SLUG` in the private input if the site uses a custom homepage path.

Provisioning generates the GraphQL schema and types from the target stack after applying its model and migrations. Use `--skip-baseline` to preserve existing model and content while applying pending migrations. To refresh the files after a later model change, run `pnpm --filter cli cli cms generate --env-file /path/to/cms-runtime.env` or run `pnpm --filter @repo/cms-contentstack generate` with package environment settings. Generate before building and include the resulting schema and types in the workspace source used by CI.

The local store writes a new `0600` dotenv file with the regional delivery and preview hosts. `--store vercel` publishes the same keys to the linked app projects. Use repeatable `--environment` flags to target Production, Preview, a Preview branch or an existing custom environment. Use `--overwrite` to update existing assignments for the selected targets. The handoff preserves `CONTENTSTACK_WEBHOOK_SECRET` when supplied and otherwise leaves it empty for later configuration. Import and migration failures report the failed step and exit status. Raw CSDX output is kept out of the command diagnostics.

The automatic host handoff supports Contentstack's named AWS, Azure, and GCP regions. A custom or dedicated-infrastructure `csdx` region needs an explicit host contract before provisioning; the command fails without writing credentials when Contentstack's endpoint utility cannot resolve it.

The Management Token configures environment URLs. Stack creation, token creation and stack-level Live Preview settings require user access. Foundry uses Connect for these operations on stacks it creates. For direct CLI runs, use the Contentstack dashboard for stack settings. The local token alias is retained and must be removed separately if it was created only for provisioning:

```bash
pnpm --filter @repo/cms-contentstack exec csdx auth:tokens:remove \
  --alias my-stack
```

The import is intentionally a one-shot empty-stack operation. It does not pass `--replace-existing`; update and reconciliation policy belongs in a later command.

## Configure Live Preview and Visual Editor

Pass the stable storefront HTTPS origin to `cms provision --production-url`. If it becomes available later or changes, update the environment with `cms preview`. The environment can be `development` even for a production deployment:

```bash
pnpm --filter cli cli --env-file /private/contentstack-management.env cms preview \
  --management-token-alias my-stack \
  --contentstack-environment development \
  --frontend-origin https://store.example.com
```

The command verifies the URLs on that environment. It uses the storefront origin for the default locale and the composed route prefixes for other locales. Run it again if the origin changes.

On Connect-created stacks, Foundry can enable Live Preview and set its default environment using its user authorization. For direct CLI runs, enable it in **Settings → Visual Experience → General** and select the same environment. Once the storefront is deployed, open a page in Live Preview and Visual Experience → Editor to check draft content and localized routes.

## Migrate an existing stack

Content-model changes after the baseline import live as timestamped CommonJS files in `migrations/`. Preview or apply them with the same local Management Token alias:

```bash
pnpm --filter cli cli cms migrate plan \
  --management-token-alias my-stack

pnpm --filter cli cli cms migrate \
  --management-token-alias my-stack

pnpm --filter cli cli cms migrate status \
  --management-token-alias my-stack
```

The workspace sorts the checked-in files, reads the durable `migrations` ledger from the target stack, and invokes the pinned `csdx cm:stacks:migration` command once for each pending file. CSDX output is streamed directly. A provider-owned patch makes validation, script, and Content Management API failures return a nonzero status; the ledger entry is created only after that process succeeds.

The baseline recipe owns the ledger content type; migration commands never create it. Its entries are administration metadata and are not published. There is no cross-request transaction between a schema change and its ledger write, so an interrupted process can require manual inspection before repair. Applied migration files are immutable; add a later migration rather than editing one.

## Validation

```bash
pnpm --filter @repo/cms-contentstack typecheck
pnpm --filter @repo/cms-contentstack test
```

## Embedding origins

Set `FRAME_ANCESTORS=https://editor.example.com,https://portal.example.com` in the frontend environment to allow additional sites to embed the application. This shared web setting preserves same-origin framing and Contentstack's regional editor origin. Use comma-separated exact HTTP(S) origins (including ports when needed), without paths, credentials or wildcards. Empty or unset adds nothing; invalid entries fail validation. Restart development or redeploy after changing it.

## Install the content search app

When Search is selected, `search provision --install-content-search-app` installs or updates the Contentstack Algolia app and applies the composed content-type mappings. It consumes the generated scoped Algolia write key directly.

Supply `CONTENTSTACK_AUTHTOKEN` (a user authtoken, not a Management Token), `CONTENTSTACK_ORG_UID`, `CONTENTSTACK_STACK_API_KEY`, `CONTENTSTACK_ENVIRONMENT`, `CONTENTSTACK_DELIVERY_TOKEN` and `CONTENTSTACK_DELIVERY_TOKEN_UID`. Set `CONTENTSTACK_BRANCH` and `CONTENTSTACK_REGION` for the target stack when needed; the complete inputs are documented in `.env.example`.

The command does not start content indexing. Follow its remaining content review, initial sync and record verification tasks. For manual app setup, use local credential output because Vercel sensitive values cannot be read back.
