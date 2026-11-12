import {
  documentRows,
  ProvisionedResource,
} from "@repo/cli-core/json-migrations";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import {
  ShippingService,
  ShippingZone,
} from "@repo/commerce-core/provisioning/shipping";
import type { ShippingSetup } from "@repo/commerce-core/provisioning/shipping";
import { Effect, Schema } from "effect";
import {
  DestinationError,
  DestinationJournalExtension,
  MigrationDefinition,
  MigrationReferenceLookup,
  Tracking,
} from "migrate-sdk";
import type {
  MigrationReferenceLookupError,
  MigrationStoreError,
} from "migrate-sdk";

import {
  recordShopifyChange,
  ShopifyDeliveryProfileRejectedError,
  ShopifyRequestRejectedError,
} from "./admin";
import type { CatalogAdmin } from "./admin";
import {
  DeliveryProfileInput,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- Provider-owned migration registry assembly.
  makeDeliveryProfileMigration,
} from "./delivery-profile-migration";
import type { DeliveryProfileReference } from "./delivery-profile-migration";
import { shopifyMoney } from "./mapping";

const PageInfo = Schema.Struct({ hasNextPage: Schema.Boolean });
const NativeId = Schema.Struct({ id: Schema.NonEmptyString });
const Profile = Schema.Struct({
  ...NativeId.fields,
  coversAllItems: Schema.Boolean,
  profileLocationGroups: Schema.Array(
    Schema.Struct({
      locationGroup: Schema.Struct({
        ...NativeId.fields,
        locations: Schema.Struct({
          nodes: Schema.Array(NativeId),
          pageInfo: PageInfo,
        }),
      }),
      locationGroupZones: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            methodDefinitions: Schema.Struct({
              nodes: Schema.Array(NativeId),
              pageInfo: PageInfo,
            }),
            zone: NativeId,
          })
        ),
        pageInfo: PageInfo,
      }),
    })
  ),
});
const RateItem = Schema.Struct({
  key: ShippingService.fields.key,
  name: ShippingService.fields.name,
  ...ShippingService.fields.rates.value.fields,
});

const rateKey = ({ key, zoneKey }: typeof RateItem.Type) => `${key}/${zoneKey}`;

const zoneLimit = 10;
const methodLimit = 20;
const profileFields = `
  id
  coversAllItems
  profileLocationGroups {
    locationGroup {
      id
      locations(first: 2) {
        nodes { id }
        pageInfo { hasNextPage }
      }
    }
    locationGroupZones(first: ${zoneLimit}) {
      pageInfo { hasNextPage }
      nodes {
        zone { id }
        methodDefinitions(first: ${methodLimit}) {
          pageInfo { hasNextPage }
          nodes { id }
        }
      }
    }
  }
`;
const readProfile = `query ShippingSetupProfile($id: ID!) {
  deliveryProfile(id: $id) { ${profileFields} }
}`;
const updateProfile = `mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
  deliveryProfileUpdate(id: $id, profile: $profile) {
    profile { ${profileFields} }
    userErrors { message }
  }
}`;

const tracking = Tracking.record({
  id: "shopify-shipping-resource@v1",
  schema: Schema.Struct({
    ...ProvisionedResource.fields,
    version: Schema.String,
  }),
});
const unconfirmedWrite = DestinationJournalExtension.make(
  "shopify-shipping-write-unconfirmed@v1",
  Schema.Literal(true)
);
const fail = (message: string) => new DestinationError({ message });

type ZoneNodes =
  (typeof Profile.Type)["profileLocationGroups"][number]["locationGroupZones"]["nodes"];
type ShippingProcess = Effect.Effect<
  void,
  | DestinationError
  | Schema.SchemaError
  | MigrationReferenceLookupError
  | MigrationStoreError,
  Tracking | MigrationReferenceLookup
>;

export const makeShippingMigrations = (options: {
  readonly admin: CatalogAdmin;
  readonly profile: DeliveryProfileInput;
  readonly read: Effect.Effect<
    ShippingSetup,
    DestinationError | Schema.SchemaError
  >;
  readonly store: ProvisioningStore;
}) =>
  Effect.gen(function* () {
    const { admin, read, store } = options;
    const profile = yield* Schema.decodeEffect(DeliveryProfileInput)(
      options.profile
    );
    const profiles = makeDeliveryProfileMigration({ admin, profile, store });
    const scopedKey = (key: string) => `${profile.key}/${key}`;
    const zoneItems = read.pipe(Effect.map(({ zones }) => zones));
    const rateItems = read.pipe(
      Effect.map(({ services }) =>
        services.flatMap(({ key, name, rates }) =>
          rates.map((rate) => ({ key, name, ...rate }))
        )
      )
    );
    const profileZones = (
      data: Schema.Json | undefined,
      reference: DeliveryProfileReference
    ) =>
      Effect.gen(function* () {
        const current = yield* Schema.decodeUnknownEffect(Profile)(data);
        const [group] = current.profileLocationGroups;
        if (
          current.id !== reference.id ||
          !current.coversAllItems ||
          current.profileLocationGroups.length !== 1 ||
          group?.locationGroup.id !== reference.locationGroupId ||
          group.locationGroup.locations.pageInfo.hasNextPage ||
          group.locationGroup.locations.nodes.length !== 1 ||
          group.locationGroup.locations.nodes[0]?.id !== profile.locationId
        ) {
          return yield* fail(
            "The tracked Shopify Delivery Profile differs from its declared fulfillment configuration"
          );
        }
        if (group.locationGroupZones.pageInfo.hasNextPage) {
          return yield* fail(
            "Unable to verify all zones in the bound Shopify location group"
          );
        }
        return group.locationGroupZones.nodes;
      });

    const createChild = ({
      key,
      reference,
      trackedIds,
      version,
      childIds,
      groupInput,
      limit,
    }: {
      readonly key: string;
      readonly reference: DeliveryProfileReference;
      readonly trackedIds: ReadonlySet<string>;
      readonly version: string;
      readonly childIds: (
        zones: ZoneNodes
      ) => Effect.Effect<readonly string[], DestinationError>;
      readonly groupInput: Readonly<Record<string, Schema.Json>>;
      readonly limit: number;
    }) =>
      Effect.gen(function* () {
        // The read verifies the bound scope against SDK records. Only the
        // mutation response can identify the child created by this attempt.
        const before = yield* admin.request(
          "Read shipping profile",
          readProfile,
          { id: reference.id }
        );
        const existing = yield* profileZones(
          before.deliveryProfile,
          reference
        ).pipe(Effect.flatMap(childIds));
        if (
          existing.length !== trackedIds.size ||
          existing.some((id) => !trackedIds.has(id))
        ) {
          return yield* fail(
            `Shopify shipping scope for ${key} differs from Migrate tracking. Verify the bound profile and its state before running setup.`
          );
        }
        if (existing.length >= limit) {
          return yield* fail(
            `The bound Shopify shipping scope already contains ${limit} children`
          );
        }
        const variables = {
          id: reference.id,
          profile: {
            locationGroupsToUpdate: [
              { ...groupInput, id: reference.locationGroupId },
            ],
          },
        };
        yield* Tracking.setExtension(unconfirmedWrite, true);
        const payload = yield* admin
          .mutation("deliveryProfileUpdate", updateProfile, variables)
          .pipe(
            Effect.tapError((error) =>
              error.cause instanceof ShopifyDeliveryProfileRejectedError ||
              error.cause instanceof ShopifyRequestRejectedError
                ? Tracking.removeExtension(unconfirmedWrite)
                : Effect.void
            )
          );
        yield* recordShopifyChange("deliveryProfileUpdate", variables, {
          profileId: reference.id,
        });

        const after = yield* profileZones(payload.profile, reference).pipe(
          Effect.flatMap(childIds)
        );
        const [id, ...extra] = after.filter(
          (childId) => !trackedIds.has(childId)
        );
        if (
          !id ||
          extra.length ||
          after.length !== trackedIds.size + 1 ||
          existing.some((childId) => !after.includes(childId))
        ) {
          return yield* fail(
            `Shopify did not confirm exactly one new child for ${key} in the mutation response`
          );
        }
        yield* Tracking.setRecord({ id, key, version });
        yield* Tracking.removeExtension(unconfirmedWrite);
      });

    const zones = MigrationDefinition.make({
      dependencies: { required: [profiles.id] },
      execution: { process: { concurrency: 1 } },
      group: "project-setup",
      id: "shopify-shipping-zones",
      process: ({ item, version }, { previousState }): ShippingProcess =>
        Effect.gen(function* () {
          const { key, countries } = item.item.payload;
          const lookup = yield* MigrationReferenceLookup;
          const reference = yield* lookup.lookup({
            definition: profiles,
            sourceIdentityKey: profile.key,
          });
          if (reference?.status !== "migrated") {
            return yield* fail(
              `Delivery Profile ${profile.key} has no successful tracking record`
            );
          }
          if (previousState?.trackingRecord) {
            if (previousState.trackingRecord.version === version) {
              return yield* Tracking.setRecord(previousState.trackingRecord);
            }
            return yield* fail(
              `Shipping Zone ${key} already has a tracking record. This migration only creates Zones.`
            );
          }
          if (
            previousState?.journal?.extensions?.[unconfirmedWrite.id] === true
          ) {
            return yield* fail(
              `Shopify did not confirm the earlier Shipping Zone write for ${key}. Inspect the item journal and the bound profile.`
            );
          }
          const items = yield* zoneItems.pipe(
            Effect.mapError(
              (cause) =>
                new DestinationError({
                  cause,
                  message: "Unable to read shipping zones",
                })
            )
          );
          const records = yield* Effect.forEach((sibling: ShippingZone) =>
            lookup.lookup({
              definition: zones,
              sourceIdentityKey: scopedKey(sibling.key),
            })
          )(items);
          yield* createChild({
            childIds: (nodes) =>
              Effect.succeed(nodes.map(({ zone }) => zone.id)),
            groupInput: {
              zonesToCreate: [
                {
                  countries: countries.map((code) => ({
                    code,
                    includeAllProvinces: true,
                  })),
                  name: key,
                },
              ],
            },
            key,
            limit: zoneLimit,
            reference: reference.trackingRecord,
            trackedIds: new Set(
              records.flatMap((record) =>
                record ? [record.trackingRecord.id] : []
              )
            ),
            version,
          });
        }),
      source: documentRows(
        Schema.toType(ShippingZone),
        zoneItems.pipe(
          Effect.map((items) =>
            items.map((item) => ({
              inputs: "shipping-zone-v2",
              item,
              key: scopedKey(item.key),
            }))
          )
        )
      ),
      store,
      tracking,
    });

    const rates = MigrationDefinition.make({
      dependencies: { required: [profiles.id, zones.id] },
      execution: { process: { concurrency: 1 } },
      group: "project-setup",
      id: "shopify-shipping-methods",
      process: ({ item, version }, { previousState }): ShippingProcess =>
        Effect.gen(function* () {
          const { payload } = item.item;
          const { name, zoneKey, price } = payload;
          const key = rateKey(payload);
          const lookup = yield* MigrationReferenceLookup;
          const reference = yield* lookup.lookup({
            definition: profiles,
            sourceIdentityKey: profile.key,
          });
          if (reference?.status !== "migrated") {
            return yield* fail(
              `Delivery Profile ${profile.key} has no successful tracking record`
            );
          }
          if (previousState?.trackingRecord) {
            if (previousState.trackingRecord.version === version) {
              return yield* Tracking.setRecord(previousState.trackingRecord);
            }
            return yield* fail(
              `Shipping Method ${key} already has a tracking record. This migration only creates Shipping Methods.`
            );
          }
          if (
            previousState?.journal?.extensions?.[unconfirmedWrite.id] === true
          ) {
            return yield* fail(
              `Shopify did not confirm the earlier Shipping Method write for ${key}. Inspect the item journal and the bound profile.`
            );
          }
          const zone = yield* lookup.lookup({
            definition: zones,
            sourceIdentityKey: scopedKey(zoneKey),
          });
          if (zone?.status !== "migrated") {
            return yield* fail(
              `Shipping Zone ${zoneKey} has no successful tracking record`
            );
          }
          const zoneId = zone.trackingRecord.id;
          const items = yield* rateItems.pipe(
            Effect.mapError(
              (cause) =>
                new DestinationError({
                  cause,
                  message: "Unable to read shipping methods",
                })
            )
          );
          const records = yield* Effect.forEach(
            (sibling: typeof RateItem.Type) =>
              lookup.lookup({
                definition: rates,
                sourceIdentityKey: scopedKey(rateKey(sibling)),
              })
          )(items.filter((sibling) => sibling.zoneKey === zoneKey));
          yield* createChild({
            childIds: (nodes) => {
              const methods = nodes.find(
                (entry) => entry.zone.id === zoneId
              )?.methodDefinitions;
              if (!methods || methods.pageInfo.hasNextPage) {
                return Effect.fail(
                  fail(
                    `Unable to verify all Shopify methods for tracked Zone ${zoneKey}`
                  )
                );
              }
              return Effect.succeed(methods.nodes.map(({ id }) => id));
            },
            groupInput: {
              zonesToUpdate: [
                {
                  id: zoneId,
                  methodDefinitionsToCreate: [
                    {
                      active: true,
                      name,
                      rateDefinition: {
                        price: {
                          amount: shopifyMoney(price),
                          currencyCode: price.currencyCode,
                        },
                      },
                    },
                  ],
                },
              ],
            },
            key,
            limit: methodLimit,
            reference: reference.trackingRecord,
            trackedIds: new Set(
              records.flatMap((record) =>
                record ? [record.trackingRecord.id] : []
              )
            ),
            version,
          });
        }),
      source: documentRows(
        Schema.toType(RateItem),
        rateItems.pipe(
          Effect.map((items) =>
            items.map((item) => ({
              inputs: "shipping-rate-v2",
              item,
              key: scopedKey(rateKey(item)),
            }))
          )
        )
      ),
      store,
      tracking,
    });
    return [profiles, zones, rates] as const;
  });
