# Customer setup inputs

These files reuse Auth Contract's `AuthUserInput`, Commerce Core's `CustomerInput` and `CustomerIdentityLinkInput`. B2C introduces no parallel Customer entity and no Business Unit or membership model.

Use `loadCustomerProvisioningInputs(directory)` from Commerce Core to validate the user, customer and identity files before provider writes. The complete setup command adds Customer-scoped grants from `storefront-permission-grants.json` and the catalog selected by `setup.json`. [The provisioning guide](../../commerce-core/provisioning/README.md) documents schema generation and native destinations for Shopify and commercetools.

The complete selected-provider setup is available through `commerce data setup --directory <this-folder>`; B2B also requires explicit provider catalog bindings. See [the shared provisioning guide](../../commerce-core/provisioning/README.md).
