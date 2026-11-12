import { documentRows } from "@repo/cli-core/json-migrations";
import type { ProvisioningStore } from "@repo/commerce-core/provisioning/pipeline";
import { Effect, Schema } from "effect";
import {
  DestinationError,
  DestinationJournalExtension,
  MigrationDefinition,
  Tracking,
} from "migrate-sdk";

import { recordShopifyChange, ShopifyRequestRejectedError } from "./admin";
import type { CatalogAdmin } from "./admin";

export const DeliveryProfileInput = Schema.Struct({
  key: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{1,63}$/u)),
  locationId: Schema.String.check(
    Schema.isPattern(/^gid:\/\/shopify\/Location\/\d+$/u)
  ),
  name: Schema.NonEmptyString,
});
export type DeliveryProfileInput = typeof DeliveryProfileInput.Type;

const ProfileReference = Schema.Struct({
  id: Schema.String.check(
    Schema.isPattern(/^gid:\/\/shopify\/DeliveryProfile\/\d+$/u)
  ),
  key: DeliveryProfileInput.fields.key,
  locationGroupId: Schema.String.check(
    Schema.isPattern(/^gid:\/\/shopify\/DeliveryLocationGroup\/\d+$/u)
  ),
  version: Schema.String,
});
export type DeliveryProfileReference = typeof ProfileReference.Type;

const CreatedProfile = Schema.Struct({
  coversAllItems: Schema.Literal(true),
  id: ProfileReference.fields.id,
  profileLocationGroups: Schema.Tuple([
    Schema.Struct({
      locationGroup: Schema.Struct({
        id: ProfileReference.fields.locationGroupId,
        locations: Schema.Struct({
          nodes: Schema.Tuple([
            Schema.Struct({ id: DeliveryProfileInput.fields.locationId }),
          ]),
          pageInfo: Schema.Struct({ hasNextPage: Schema.Literal(false) }),
        }),
      }),
    }),
  ]),
});

const createProfile = `mutation deliveryProfileCreate($profile: DeliveryProfileInput!) {
  deliveryProfileCreate(profile: $profile) {
    profile {
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
      }
    }
    userErrors { message }
  }
}`;

const unconfirmedCreate = DestinationJournalExtension.make(
  "shopify-delivery-profile-create-unconfirmed@v1",
  Schema.Literal(true)
);

export const makeDeliveryProfileMigration = ({
  admin,
  profile,
  store,
}: {
  readonly admin: CatalogAdmin;
  readonly profile: DeliveryProfileInput;
  readonly store: ProvisioningStore;
}) =>
  MigrationDefinition.make({
    group: "project-setup",
    id: "shopify-delivery-profiles",
    process: ({ item, version }, { previousState }) =>
      Effect.gen(function* () {
        const { key, locationId, name } = item.item.payload;
        if (previousState?.trackingRecord) {
          if (previousState.trackingRecord.version === version) {
            return yield* Tracking.setRecord(previousState.trackingRecord);
          }
          return yield* new DestinationError({
            message: `Delivery Profile ${key} already has a tracking record. This migration only creates Delivery Profiles.`,
          });
        }
        if (
          previousState?.journal?.extensions?.[unconfirmedCreate.id] === true
        ) {
          return yield* new DestinationError({
            message: `Shopify did not confirm the earlier Delivery Profile create for ${key}. Inspect the item journal and Shopify before retrying.`,
          });
        }
        const variables = {
          profile: {
            coversAllItems: true,
            locationGroupsToCreate: [{ locationsToAdd: [locationId] }],
            name,
          },
        };
        yield* admin.authenticate;
        yield* Tracking.setExtension(unconfirmedCreate, true);
        yield* Tracking.checkpoint;
        const data = yield* admin
          .request("deliveryProfileCreate", createProfile, variables)
          .pipe(
            Effect.tapError((error) =>
              error.cause instanceof ShopifyRequestRejectedError
                ? Tracking.removeExtension(unconfirmedCreate).pipe(
                    Effect.andThen(Tracking.checkpoint)
                  )
                : Effect.void
            )
          );
        const payload = yield* Schema.decodeUnknownEffect(
          Schema.Record(Schema.String, Schema.Json)
        )(data.deliveryProfileCreate).pipe(
          Effect.mapError(
            (cause) =>
              new DestinationError({
                cause,
                message: `Shopify did not return a Delivery Profile creation result for ${key}`,
              })
          )
        );
        if (payload.profile !== null && payload.profile !== undefined) {
          yield* recordShopifyChange(
            "deliveryProfileCreate",
            variables,
            payload
          );
          yield* Tracking.checkpoint;
        }
        const errors = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ message: Schema.String }))
        )(payload.userErrors).pipe(
          Effect.mapError(
            (cause) =>
              new DestinationError({
                cause,
                message: `Shopify returned invalid Delivery Profile creation errors for ${key}`,
              })
          )
        );
        if (errors.length > 0) {
          if (payload.profile === null) {
            yield* Tracking.removeExtension(unconfirmedCreate);
            yield* Tracking.checkpoint;
          }
          return yield* new DestinationError({
            message: `Delivery Profile ${key} creation failed. ${errors.map(({ message }) => message).join(" ")}`,
          });
        }
        const created = yield* Schema.decodeUnknownEffect(CreatedProfile)(
          payload.profile
        ).pipe(
          Effect.mapError(
            (cause) =>
              new DestinationError({
                cause,
                message: `Shopify did not confirm the created Delivery Profile and location group for ${key}`,
              })
          )
        );
        const [{ locationGroup }] = created.profileLocationGroups;
        const [location] = locationGroup.locations.nodes;
        if (location.id !== locationId) {
          return yield* new DestinationError({
            message: `Shopify returned a different fulfillment Location for Delivery Profile ${key}`,
          });
        }
        yield* Tracking.setRecord({
          id: created.id,
          key,
          locationGroupId: locationGroup.id,
          version,
        });
        yield* Tracking.removeExtension(unconfirmedCreate);
      }),
    source: documentRows(
      DeliveryProfileInput,
      Effect.succeed([{ item: profile, key: profile.key }])
    ),
    store,
    tracking: Tracking.record({
      id: "shopify-delivery-profile@v1",
      schema: ProfileReference,
    }),
  });
