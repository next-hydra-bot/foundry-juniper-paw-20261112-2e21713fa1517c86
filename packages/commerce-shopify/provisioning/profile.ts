import { loadCatalogFile } from "@repo/commerce-core/catalog/files";
/* oxlint-disable anti-slop-effect/no-service-constructor-imports -- This CLI composition root assembles provider-owned Migrate destinations. */
import { prepareCustomerProfile } from "@repo/commerce-core/provisioning/pipeline";
import type {
  ProvisioningCatalog,
  ProvisioningStore,
  ProfilePreparation,
} from "@repo/commerce-core/provisioning/pipeline";
import { Config, ConfigProvider, Effect, Option, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import { prepareAdminSettings } from "../admin/provisioning";
import { journalCatalogAdmin, makeCatalogAdmin } from "../catalog/admin";
import {
  CatalogSettings,
  makeCatalogDestination,
} from "../catalog/destination";
import { makeCatalogRegistry } from "../catalog/migrations";
import { makeCustomerDestination } from "./customers";
import { makeIdentityLinkDestination } from "./identity-links";
import { withTaxSetup } from "./tax";

const fail = () =>
  new DestinationError({
    message:
      "Configure the Shopify domain, catalog location/publication IDs and Admin credentials for setup.",
  });
export const prepareTargets = (config: ConfigProvider.ConfigProvider) =>
  Effect.gen(function* () {
    const configured = yield* Config.all({
      appClientId: Config.String("SHOPIFY_ADMIN_CLIENT_ID"),
      domain: Config.String("SHOPIFY_STORE_DOMAIN"),
      locationId: Config.option(Config.String("SHOPIFY_CATALOG_LOCATION_ID")),
      publicationId: Config.String("SHOPIFY_CATALOG_PUBLICATION_ID"),
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, config));
    const target = {
      ...configured,
      locationId: Option.getOrUndefined(configured.locationId),
    };
    // Validate public target settings even for a credential-free plan.
    yield* Schema.decodeEffect(
      Schema.Struct({
        domain: CatalogSettings.fields.domain,
        locationId: CatalogSettings.fields.locationId,
        publicationId: CatalogSettings.fields.publicationId,
      })
    )(target);
    const adminSettings = yield* prepareAdminSettings(config);
    const settings = adminSettings.pipe(
      Effect.map((credentials) => ({ ...target, ...credentials }))
    );
    const admin = journalCatalogAdmin(makeCatalogAdmin(settings));
    return {
      admin,
      catalogDefinitions: (
        catalog: ProvisioningCatalog,
        store: ProvisioningStore
      ) => {
        const readers = {
          [catalog.files.catalogName]: () =>
            loadCatalogFile(catalog.catalogFile),
        };
        return makeCatalogRegistry({
          readers,
          locationId: target.locationId,
          publicationId: target.publicationId,
          destination: makeCatalogDestination({ readers, settings }),
          store,
        }).definitions();
      },
      customers: makeCustomerDestination(settings),
      linkIdentity: makeIdentityLinkDestination(admin),
      settings,
      target: `shopify:${target.domain}/${target.appClientId}`,
    };
  }).pipe(Effect.mapError(fail));
export const prepareB2CProfile = (options: ProfilePreparation) =>
  Effect.gen(function* () {
    const base = yield* prepareTargets(options.config);
    const targets = yield* withTaxSetup(options, base, base.admin);
    return yield* prepareCustomerProfile(options, targets);
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof DestinationError
        ? cause
        : new DestinationError({
            message:
              "Invalid Shopify B2C setup profile or target configuration.",
          })
    )
  );
