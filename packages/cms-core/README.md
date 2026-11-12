# Shared CMS content

The authoring files are provider-neutral. Provider provisioning owns native types, fields, blocks and locales. Run it before importing content with Migrate SDK and its file-backed, destination-scoped tracking. CLI authoring and planning need no CMS credentials.

From an installed workspace, discover the selected provider's command options:

    pnpm --filter cli cli cms data --help
    pnpm --filter cli cli cms data model --output content-model.json
    pnpm --filter cli cli cms data init --directory ./content --model content-model.json
    pnpm --filter cli cli cms data schema --model ./content/content-model.json --output content.schema.json
    pnpm --filter cli cli cms data validate --directory ./content
    pnpm --filter cli cli cms data setup --directory ./content --state-directory ./.migrate --plan

The exported schema describes an object with model, assets, entries, navigation and announcements properties. Store those respective values as content-model.json, assets.json, entries.json, navigation.json and announcements.json in the folder. All five files are required; unused collections are empty arrays. The schema is derived from Effect and its entry/block alternatives follow the selected model.

The initial portable model supports page and article entries, hero/rich-text blocks and, when commerce is installed, product-collection blocks. It declares the profile key, default locale and enabled locales. These are installed authoring types, not an arbitrary CMS schema language; additional types need provider mappings and frontend rendering. Native provider fields outside this contract remain provider-owned.

Each logical entry has a stable key and one record per locale. Every translation needs its default-locale record. Routes are relative application paths; locale prefixes belong to routing, not the path field. Links use either an entryKey or a URL. Rich text uses paragraph/heading blocks with text spans and bold/italic marks. Heading level is 2, 3 or 4. A hero has at most two links, matching the current Drupal hero. Images use asset keys; assets supply a file path relative to the profile folder or an HTTP(S) URL and alt text for each used locale. Local asset byte changes participate in the import revision; change a remote source URL to explicitly import changed remote bytes.

Each `navigation.json` record has key `main` and a locale. `items` supplies the header menu. Use `brandName` for the name shown in the header and footer, `footerDescription` for optional footer copy, and `footerItems` for footer links. Both menus support one level of child links. An empty `footerItems` array clears that menu. Use an empty `footerDescription` to clear the copy. Omitting the new fields keeps existing content.

Validation traverses all files and checks types, unique keys/routes, translations, assets and content links. Planning does the same traversal, lists migrations and reports commerce category keys without reading or writing destination resources. CMS planning does not claim that external commerce IDs already exist.

Content is imported through named Migrate definitions for assets, articles, pages, navigation and announcements, with publication records for each entry kind and environment. The profile uses the types, blocks and locales already available on the target CMS. Pages depend on assets, articles and, for product collections, the selected commerce provider's existing category migration. MigrationReferenceLookup resolves native identities from the declared definitions.

For commerce blocks, keep categoryKey in the CMS source and supply the original commerce source profile and Migrate state root:

    pnpm --filter cli cli cms data setup --directory ./content --commerce-directory ./catalog --state-directory /path/to/project-migrate-state

The command composes the selected provider's existing category definition and its dependencies with the CMS definitions. The composed run uses the original commerce project store and source identities. CMS definition IDs include the CMS destination identity, so multiple sites or stacks remain separate within that store. Reuse the same state root used by commerce data setup. Supply --bindings when its commerce binding file is not bindings.json inside the commerce profile. Configure the same private commerce/auth environment used by that import. Source planning validates category keys from the actual commerce profile without credentials or destination calls. There is no separate native-ID export or mapping file.

For Drupal, first complete normal cms provision, then run:

    pnpm --filter cli cli cms data setup --directory ./content --state-directory ./.migrate --app-directory ../drupal

The app directory is relative to the CLI process (normally apps/cli). The default transport is ddev. On a bootstrapped Drupal host, --transport drush uses its local Drush executable instead. The selected recipes must supply the Canvas components, article fields, languages and `cms_navigation` module. For an older site, enable `cms_navigation` through Drush during site setup. Entry publication is a separate stage. Imported header and footer links use separate native menus per locale. The CMS navigation module resolves both GraphQL menus and falls back to starter menus for languages without imported navigation. The brand and footer copy use the native site name and slogan. Each locale can have its own links, order and empty menu.

For Contentstack, first complete normal cms provision and configure its alias:

    pnpm --filter cli cli cms data setup --directory ./content --state-directory ./.migrate --management-token-alias my-stack --branch main --contentstack-environment development

The stack needs the selected content types and blocks, including the recipe's source key fields, and the profile's locales before import. Assets and entries use the Management Token alias. Publication targets the named environment. Entry identity is scoped to the stack and branch and shared across publish environments. The importer adopts starter entries by route and the existing navigation by its singleton identity, then assigns source keys. Run `cms migrate` before importing branded navigation into a stack created before the brand and footer fields were added. Delivery and preview use their own runtime tokens.

Keep the same profile key, target and state directory when updating or retrying. The importer upserts declared entries. Omitted pages/articles are retained; removing source records is not an implicit deletion request. Ordinary CLI/API errors describe failures, and the Migrate state records completed work. Verify published routes, translated navigation and draft preview in the actual frontend after import. A plan alone proves only local source validity.
