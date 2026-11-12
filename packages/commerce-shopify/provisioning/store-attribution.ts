import { Effect, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

import type { CatalogAdmin } from "../catalog/admin";
import { storeAttributionMetafield } from "../store-attribution";

const Definition = Schema.Struct({
  capabilities: Schema.Struct({
    adminFilterable: Schema.Struct({ enabled: Schema.Boolean }),
    cartToOrderCopyable: Schema.Struct({ enabled: Schema.Boolean }),
  }),
  id: Schema.NonEmptyString,
  key: Schema.String,
  namespace: Schema.String,
  ownerType: Schema.String,
  type: Schema.Struct({ name: Schema.String }),
});
const definitionFields = `id namespace key ownerType type { name }
  capabilities { adminFilterable { enabled } cartToOrderCopyable { enabled } }`;
const identifier = {
  key: storeAttributionMetafield.key,
  namespace: storeAttributionMetafield.namespace,
  ownerType: "ORDER",
} as const;
const fail = (message: string) => new DestinationError({ message });
const decodeDefinition = Schema.decodeUnknownEffect(Definition);

/** Owns the shop-wide Order attribution definition. */
export const provisionStoreAttribution = Effect.fn(
  "Shopify.provisionStoreAttribution"
)(function* <R>(admin: CatalogAdmin<R>, trackedId?: string) {
  const data = yield* admin.request(
    "storeAttribution",
    `query StoreAttributionDefinition($identifier:MetafieldDefinitionIdentifierInput!) {
      metafieldDefinition(identifier:$identifier) { ${definitionFields} }
    }`,
    { identifier }
  );
  const current = yield* Schema.decodeUnknownEffect(Schema.NullOr(Definition))(
    data.metafieldDefinition
  ).pipe(
    Effect.mapError(() => fail("Invalid Store attribution definition response"))
  );
  if ((current?.id ?? undefined) !== trackedId) {
    return yield* fail(
      "The commerce.store_key Order definition differs from its tracking record"
    );
  }
  if (
    current !== null &&
    (current.namespace !== identifier.namespace ||
      current.key !== identifier.key ||
      current.ownerType !== identifier.ownerType ||
      current.type.name !== storeAttributionMetafield.type)
  ) {
    return yield* fail(
      "The commerce.store_key Order definition has an incompatible type or identity. Reconcile it before provisioning."
    );
  }
  const ready =
    current?.capabilities.adminFilterable.enabled &&
    current.capabilities.cartToOrderCopyable.enabled;
  if (ready) {
    return current.id;
  }
  const action = current === null ? "create" : "update";
  const capabilities = {
    adminFilterable: { enabled: true },
    cartToOrderCopyable: { enabled: true },
  };
  const payload =
    action === "create"
      ? yield* admin.mutation(
          "metafieldDefinitionCreate",
          `mutation CreateStoreAttribution($definition:MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition:$definition) {
              createdDefinition { ${definitionFields} } userErrors { message }
            }
          }`,
          {
            definition: {
              ...identifier,
              capabilities,
              description:
                "Originating storefront Store key. Independent of shipping country and company pricing group.",
              name: "Store of origin",
              type: storeAttributionMetafield.type,
            },
          }
        )
      : yield* admin.mutation(
          "metafieldDefinitionUpdate",
          `mutation UpdateStoreAttribution($definition:MetafieldDefinitionUpdateInput!) {
            metafieldDefinitionUpdate(definition:$definition) {
              updatedDefinition { ${definitionFields} } userErrors { message }
            }
          }`,
          { definition: { ...identifier, capabilities } }
        );
  const updated = yield* decodeDefinition(
    payload[action === "create" ? "createdDefinition" : "updatedDefinition"]
  ).pipe(
    Effect.mapError(() =>
      fail(
        "Store attribution write could not be confirmed. Read the provision plan before retrying."
      )
    )
  );
  if (
    (trackedId !== undefined && updated.id !== trackedId) ||
    updated.namespace !== identifier.namespace ||
    updated.key !== identifier.key ||
    updated.ownerType !== identifier.ownerType ||
    updated.type.name !== storeAttributionMetafield.type ||
    !updated.capabilities.adminFilterable.enabled ||
    !updated.capabilities.cartToOrderCopyable.enabled
  ) {
    return yield* fail(
      "Shopify did not enable Store attribution copying and filtering. Read the provision plan before retrying."
    );
  }
  return updated.id;
});
