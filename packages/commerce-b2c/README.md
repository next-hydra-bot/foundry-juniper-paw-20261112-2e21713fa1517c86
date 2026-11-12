# @repo/commerce-b2c

B2C purchasing for anonymous visitors and authenticated Customers, built on `@repo/commerce-core`. Its B2C context and registration programs have no company or provider dependency; the purchasing context extension accepts an existing context resolver, and the account page accepts a fallback view from the application, without a runtime dependency on company purchasing. Separate account UI entry points use the shared design system and Next.js application routes supply authentication and provider bindings.

`b2cPurchasingContextLayer` derives a linked Customer from verified authentication identity. It does not require Business Unit membership and does not accept company selectors. Core distinguishes B2C purchasing authority from company authority throughout Cart, Checkout and Order operations.

Applications remain composition roots. The current web and API applications explicitly compose this package alongside `commerce-b2b` and the selected Commercetools/payment implementations. Web offers B2C purchasing in the context switcher; a Customer with no company membership defaults to B2C purchasing unless a company was explicitly selected. Existing eligible company buyers keep company purchasing by default. B2C and company carts remain separate, and switching context selects the appropriate cart without merging the anonymous cart.

The checkout API selects B2C purchasing with `x-context-purchasing-context: personal` alongside the authenticated bearer token and `x-context-locale`. Supplying a Business Unit selector at the same time is rejected. The API retains its existing company default when the new selector is absent. Customer IDs supplied by clients are never authority.

B2C checkout uses the shared contact, delivery, shipping, card payment and order flows. Customer Profile can provide Contact. Customers registered for B2C purchasing are not eligible for company credit terms. Orders and carts are scoped to Customer, Store and B2C purchasing; a company cart or another Customer's cart/order cannot be substituted.

`/register/personal` uses the existing sign-in provider and the same person/address layout as company registration, without company name, company phone, VAT, membership or approval fields. The server reads the authentication identity and email from its session, provisions or reuses a Customer through Core's `CustomerProfiles` capability, and saves the initial address. An email match alone never links a Customer. The provider does not assert that a newly provisioned customer's email is verified.

`/[locale]/account` is a site-authenticated overview supplied by Commerce Core. Profile and saved-address management live at `/[locale]/account/profile`. The complete installed account navigation is visible on every account page. New authenticated users without a Customer mapping are directed to customer registration when opening their commerce profile. Profile names can be updated; email remains owned by authentication. Customers can add, edit, remove, and set a default saved address. Editing preserves the existing default status. Custom checkout can also select or save an address. Order history is supplied by the selected purchasing recipe.

The provider-backed Address Book selects Customer ownership for B2C authority and verified associate/Business Unit ownership for company authority. The Address Book API accepts the same explicit B2C selector as checkout. No address or Customer ID submitted by a client establishes authority.

Commercetools stores B2C enrollment in the `customer-personal-accounts` Custom Object container, keyed by Customer ID. Removing an enrolled Customer's last company membership retains that Customer and removes the company identity projection. Company-only retirement keeps its existing behavior.

The current complete Commerce recipe remains blended B2B + B2C, including company registration and administration. Treat B2C and company registration as separate Customer lifecycles for now: transitioning an existing Customer between them is not supported. This package does not introduce a B2C-only public selection, Shopify or hosted checkout.

Commercetools implements B2C carts using ordinary Customer ownership without a Business Unit, as described in its [Cart API](https://docs.commercetools.com/api/projects/carts).

```sh
pnpm --filter @repo/commerce-b2c test
pnpm --filter @repo/commerce-b2c typecheck
```

Feature modules follow the company purchasing layout. `customer-account/` owns the account page, view, reusable profile/address fields, identity reader, procedures and actions. `registration/` owns the customer registration page, form, input schema, procedures, actions and use-case programs. `commerce-context/` owns purchasing selection, its cookie action and the extension that adds B2C purchasing to an application-supplied context resolver. Framework-specific code stays beside its feature.

`customer-account/action-contract` supplies the shared account and registration Action error schemas. Expected failures preserve their exact tags, stable codes and recovery guidance through serialization. Private provider diagnostics are logged and omitted from public values; invalid provider data remains a defect. An unknown address-write outcome retains its address reference and asks the caller to refresh before retrying.

The `registration` entry point exports `CustomerRegistrationPage` and its form/schema. Package-owned recipes bind that page into the shared route template and supply the selected authentication readers. The page binds its own server action. The combined registration recipe supplies package-owned navigation links; existing company action bindings remain in the application.

`registration/programs` supplies `makeCustomerRegistrationProgram`. Registration procedures bind the application-selected address-book request provider once; the program saves the Customer before resolving Customer-owned address-book authority and saving the initial address. This order permits first-time enrollment without an existing Customer mapping. Typed failures and the address reference pass through unchanged. Actions and procedures obtain trusted identity, map failures and persist the purchasing-context cookie after success. The application selects concrete Layers and binds `@repo/commerce-b2c/bindings` to its existing runtime, following the existing B2B runtime binding pattern.

`commerce-context/purchasing-context` exports both selectors: `makeExplicitPurchasingCommerceContextLayer` retains the API's company default, while `makePurchasingCommerceContextLayer` supplies the web fallback from a mapped Customer with no company membership to B2C purchasing. Explicit unavailable company selections remain errors. Both accept the existing resolver from the application.

`customer-account` exports `CustomerAccountPage` for profile and address management. It imports no B2B implementation. Provider recipes install the thin profile route and contribute its navigation entry; Core owns the overview and active-navigation presentation. The application's generated navigation binding assembles installed contributions without introducing Core-to-domain package dependencies.

Public compatibility spellings are unchanged by the naming cleanup: `/register/personal`, the `personal` purchasing selector, `storefrontPersonal` checkout channel, existing registration recipe IDs and the `customer-personal-accounts` storage container. Code and domain terminology use B2C Purchasing for the purchasing mode and Customer for identity, profile and registration.
