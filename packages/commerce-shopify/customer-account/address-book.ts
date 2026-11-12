import "server-only";
import { CountryCode } from "@repo/commerce-core/domain/address";
import {
  AddressBookAccessDenied,
  AddressBookEntry,
  AddressBookEntryNotFound,
  AddressBookProviderFailure,
  AddressBookReference,
  AddressBookWriteOutcomeUnknown,
  addressBookMutationRejected,
} from "@repo/commerce-core/domain/address-book";
import type {
  AddressBookOperation,
  SaveAddressBookEntryInput,
} from "@repo/commerce-core/domain/address-book";
import {
  addressRegionCode,
  addressRegions,
} from "@repo/commerce-core/domain/address-regions";
import { AddressBook } from "@repo/commerce-core/services/address-book";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { createShopifyRequestContext } from "@shopify/hydrogen";
import {
  createCustomerAccountClient,
  gql,
} from "@shopify/hydrogen/customer-account";
import { Effect, Layer, Redacted, Schema } from "effect";

import { storefrontContext } from "../store";
import { ShopifyCustomerAccounts } from "./accounts";
import { customerAccountKeys } from "./keys";

const addressesQuery = gql(`query CustomerSavedAddresses($after:String) {
  customer { id defaultAddress { id } addresses(first:100,after:$after) {
    nodes { id address1 address2 city countryCode zip zoneCode firstName lastName company phoneNumber }
    pageInfo { hasNextPage endCursor }
  } }
}`);
const createAddress =
  gql(`mutation CustomerAddressSaveNew($address:CustomerAddressInput!,$defaultAddress:Boolean!) {
  saved: customerAddressCreate(address:$address,defaultAddress:$defaultAddress) { customerAddress { id } userErrors { message } }
}`);
const updateAddress =
  gql(`mutation CustomerAddressSaveExisting($id:ID!,$address:CustomerAddressInput,$defaultAddress:Boolean) {
  saved: customerAddressUpdate(addressId:$id,address:$address,defaultAddress:$defaultAddress) { customerAddress { id } userErrors { message } }
}`);
const deleteAddress = gql(`mutation CustomerAddressRemove($id:ID!) {
  removed: customerAddressDelete(addressId:$id) { deletedAddressId userErrors { code message } }
}`);
const NativeAddress = Schema.Struct({
  id: Schema.NonEmptyString,
  address1: Schema.NullOr(Schema.String),
  address2: Schema.NullOr(Schema.String),
  city: Schema.NullOr(Schema.String),
  countryCode: Schema.NullOr(CountryCode),
  zip: Schema.NullOr(Schema.String),
  zoneCode: Schema.NullOr(Schema.String),
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  phoneNumber: Schema.NullOr(Schema.String),
});
const Addresses = Schema.Struct({
  customer: Schema.Struct({
    id: Schema.NonEmptyString,
    defaultAddress: Schema.NullOr(Schema.Struct({ id: Schema.NonEmptyString })),
    addresses: Schema.Struct({
      nodes: Schema.Array(NativeAddress),
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String),
      }),
    }),
  }),
});
const AddressesEnvelope = Schema.Struct({
  data: Schema.optionalKey(Schema.NullOr(Addresses)),
  errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
const SavedAddress = Schema.Struct({
  customerAddress: Schema.NullOr(Schema.Struct({ id: Schema.NonEmptyString })),
  userErrors: Schema.Array(Schema.Struct({ message: Schema.String })),
});
const RemovedAddress = Schema.Struct({
  deletedAddressId: Schema.NullOr(Schema.NonEmptyString),
  userErrors: Schema.Array(
    Schema.Struct({
      code: Schema.NullOr(Schema.String),
      message: Schema.String,
    })
  ),
});
const isUnsupportedCustomerAddressCountry = Schema.is(
  Schema.Literals(["AQ", "AS", "FM", "GU", "MH", "MP", "PR", "PW", "VI"])
);
const referenceFor = (id: string) =>
  Schema.decodeUnknownSync(AddressBookReference)(
    `shopify_${Buffer.from(id).toString("base64url")}`
  );
const unavailable = (operation: AddressBookOperation) =>
  new AddressBookProviderFailure({
    message: "Saved addresses could not be read. Refresh your account.",
    operation,
    reason: "unavailable",
  });
const denied = (operation: AddressBookOperation) =>
  new AddressBookAccessDenied({
    message:
      "Saved customer addresses require the connected customer's personal purchasing context.",
    operation,
  });
const missing = (reference: AddressBookReference) =>
  new AddressBookEntryNotFound({
    message: "This customer address is unavailable.",
    reference,
  });
const uncertain = (reference: AddressBookReference) =>
  new AddressBookWriteOutcomeUnknown({
    message:
      "The address may have changed. Refresh your account before submitting again.",
    reference,
  });
const entry = (
  address: typeof NativeAddress.Type,
  defaultId: string | undefined
) =>
  new AddressBookEntry({
    reference: referenceFor(address.id),
    address: {
      addressLine1: address.address1 ?? "",
      addressLine2: address.address2 ?? undefined,
      city: address.city ?? "",
      country: address.countryCode ?? undefined,
      postalCode: address.zip ?? "",
      region: address.zoneCode ?? undefined,
    },
    defaultShipping: address.id === defaultId,
    defaultBilling: address.id === defaultId,
    types: ["shipping", "billing"],
  });

export const customerAddressBookLayerWith = ({
  environment,
  fetchApi = globalThis.fetch,
}: {
  readonly environment: ReturnType<typeof customerAccountKeys>;
  readonly fetchApi?: typeof globalThis.fetch;
}) =>
  Layer.effect(
    AddressBook,
    Effect.gen(function* () {
      const accounts = yield* ShopifyCustomerAccounts;
      const context = yield* CommerceContext;
      const client = createCustomerAccountClient({
        fetch: async (input, init) =>
          await fetchApi(input, { ...init, cache: "no-store" }),
        shopId: environment.SHOPIFY_SHOP_ID,
        requestContext: createShopifyRequestContext({
          i18n: storefrontContext(context.store),
          request: {
            headers: new Headers(),
            url: environment.SHOPIFY_STOREFRONT_ORIGIN,
          },
        }),
      });
      const identity = (operation: AddressBookOperation, writable = false) =>
        Effect.gen(function* () {
          if (context.principal._tag !== "B2CPurchasingPrincipal") {
            return yield* denied(operation);
          }
          const refreshedToken = writable
            ? yield* accounts.cartAccessToken
            : undefined;
          const current = yield* accounts.read;
          if (
            !current?.accessToken ||
            current.authUserId !== context.principal.authUserId ||
            current.customer.id !== context.principal.customerId
          ) {
            return yield* denied(operation);
          }
          return {
            customer: current.customer,
            token: Redacted.value(refreshedToken ?? current.accessToken),
          };
        }).pipe(
          Effect.catchTag("ShopifyCustomerSessionFailure", () =>
            Effect.fail(denied(operation))
          )
        );
      const list = (
        operation: AddressBookOperation,
        token: string,
        customerId: string
      ) =>
        Effect.gen(function* () {
          const nodes: (typeof NativeAddress.Type)[] = [];
          const ids = new Set<string>();
          const cursors = new Set<string>();
          let after: string | null = null;
          let defaultId: string | undefined;
          while (true) {
            const cursor: string | null = after;
            const response: typeof AddressesEnvelope.Type =
              yield* Effect.tryPromise(
                async () =>
                  await client.graphql(addressesQuery, {
                    accessToken: token,
                    variables: { after: cursor },
                  })
              ).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(AddressesEnvelope))
              );
            if ((response.errors?.length ?? 0) > 0 || !response.data) {
              return yield* unavailable(operation);
            }
            const page = response.data;
            if (page.customer.id !== customerId) {
              return yield* denied(operation);
            }
            const pageDefault = page.customer.defaultAddress?.id;
            if (after !== null && defaultId !== pageDefault) {
              return yield* unavailable(operation);
            }
            defaultId = pageDefault;
            for (const address of page.customer.addresses.nodes) {
              if (ids.has(address.id)) {
                return yield* unavailable(operation);
              }
              ids.add(address.id);
              nodes.push(address);
            }
            const info = page.customer.addresses.pageInfo;
            if (!info.hasNextPage) {
              break;
            }
            if (!info.endCursor || cursors.has(info.endCursor)) {
              return yield* unavailable(operation);
            }
            cursors.add(info.endCursor);
            after = info.endCursor;
          }
          if (defaultId !== undefined && !ids.has(defaultId)) {
            return yield* unavailable(operation);
          }
          const entries = yield* Effect.try(() =>
            nodes.map((address) => entry(address, defaultId))
          );
          return { entries, nodes, defaultId };
        }).pipe(
          Effect.catchTags({
            UnknownError: () => Effect.fail(unavailable(operation)),
            SchemaError: () => Effect.fail(unavailable(operation)),
          })
        );
      const save = Effect.fn("ShopifyAddressBook.save")(function* (
        input: SaveAddressBookEntryInput,
        operation: "save" | "edit"
      ) {
        const current = yield* identity(operation, true);
        if (
          input.types.length !== 2 ||
          input.defaultBilling !== input.defaultShipping
        ) {
          return yield* Effect.fail(
            addressBookMutationRejected({
              message:
                "Shopify customer addresses are available for both billing and shipping and share one default.",
              reference: input.reference,
            })
          );
        }
        const before = yield* list(
          operation,
          current.token,
          current.customer.id
        );
        const previous = before.nodes.find(
          (address) => referenceFor(address.id) === input.reference
        );
        if (!previous && operation === "edit") {
          return yield* missing(input.reference);
        }
        if (!previous && input.reference.startsWith("shopify_")) {
          return yield* denied("save");
        }
        if (
          operation === "save" &&
          previous &&
          previous.id === before.defaultId &&
          !input.defaultShipping
        ) {
          return yield* Effect.fail(
            addressBookMutationRejected({
              message:
                "Choose another default address before clearing this default.",
              reference: input.reference,
            })
          );
        }
        const countryCode = yield* Schema.encodeEffect(CountryCode)(
          input.address.country
        ).pipe(Effect.orDie);
        const regions = addressRegions(countryCode);
        const region = yield* Effect.succeed(
          addressRegionCode(countryCode, input.address.region)
        ).pipe(
          Effect.filterOrFail(
            (region) =>
              regions.length === 0 ||
              regions.some(({ code }) => code === region),
            () =>
              addressBookMutationRejected({
                message: "Choose a valid state or province for this country.",
                reference: input.reference,
              })
          )
        );
        if (isUnsupportedCustomerAddressCountry(countryCode)) {
          return yield* Effect.fail(
            addressBookMutationRejected({
              message:
                "This country code is not supported by Shopify's customer address API.",
              reference: input.reference,
            })
          );
        }
        const address = {
          address1: input.address.addressLine1,
          address2: input.address.addressLine2 ?? null,
          city: input.address.city,
          countryCode,
          zip: input.address.postalCode,
          zoneCode: region ?? null,
          firstName: previous ? previous.firstName : current.customer.firstName,
          lastName: previous ? previous.lastName : current.customer.lastName,
          company: previous?.company ?? null,
          phoneNumber: previous?.phoneNumber ?? null,
        };
        const result = yield* Effect.tryPromise(async () =>
          previous
            ? await client.graphql(updateAddress, {
                accessToken: current.token,
                variables: {
                  id: previous.id,
                  address,
                  defaultAddress:
                    operation === "edit" ? undefined : input.defaultShipping,
                },
              })
            : await client.graphql(createAddress, {
                accessToken: current.token,
                variables: {
                  address,
                  defaultAddress: input.defaultShipping,
                },
              })
        ).pipe(Effect.mapError(() => uncertain(input.reference)));
        if ((result.errors?.length ?? 0) > 0) {
          return yield* uncertain(input.reference);
        }
        const saved = yield* Schema.decodeUnknownEffect(SavedAddress)(
          result.data?.saved
        ).pipe(Effect.mapError(() => uncertain(input.reference)));
        if (saved.userErrors.length && saved.customerAddress === null) {
          return yield* Effect.fail(
            addressBookMutationRejected({
              message:
                "Shopify rejected this address. Check its country, region, postal code and street line.",
              reference: input.reference,
            })
          );
        }
        const id = saved.customerAddress?.id;
        if (
          !id ||
          saved.userErrors.length ||
          (previous && id !== previous.id)
        ) {
          return yield* uncertain(input.reference);
        }
        const after = yield* list(
          operation,
          current.token,
          current.customer.id
        ).pipe(Effect.mapError(() => uncertain(input.reference)));
        const confirmed = after.entries.find(
          (item) => item.reference === referenceFor(id)
        );
        if (!confirmed || (input.defaultShipping && after.defaultId !== id)) {
          return yield* uncertain(input.reference);
        }
        return confirmed;
      });
      return AddressBook.of({
        list: () =>
          Effect.gen(function* () {
            const current = yield* identity("list");
            return (yield* list("list", current.token, current.customer.id))
              .entries;
          }),
        get: (reference) =>
          Effect.gen(function* () {
            const current = yield* identity("get");
            const result = yield* list(
              "get",
              current.token,
              current.customer.id
            );
            const found = result.entries.find(
              (address) => address.reference === reference
            );
            return found ?? (yield* missing(reference));
          }),
        save: (input) =>
          save(input, "save").pipe(
            Effect.catchTag("AddressBookEntryNotFound", () =>
              Effect.fail(denied("save"))
            )
          ),
        change: Effect.fn("ShopifyAddressBook.change")(
          function* (reference, change) {
            const { operation } = change;
            if (operation === "edit") {
              yield* save(
                {
                  address: change.address,
                  defaultBilling: false,
                  defaultShipping: false,
                  reference,
                  types: ["shipping", "billing"],
                },
                "edit"
              );
              return;
            }
            const current = yield* identity(operation, true);
            const before = yield* list(
              operation,
              current.token,
              current.customer.id
            );
            const previous = before.nodes.find(
              (address) => referenceFor(address.id) === reference
            );
            if (!previous) {
              return yield* missing(reference);
            }
            const rejected = (defaultRemoval = false) =>
              addressBookMutationRejected({
                message: defaultRemoval
                  ? "Choose another default address before removing this address."
                  : "Shopify rejected this address change.",
                reason: defaultRemoval ? "defaultAddressRemoval" : undefined,
                reference,
              });
            if (operation === "remove") {
              if (before.defaultId === previous.id) {
                return yield* Effect.fail(rejected(true));
              }
              const result = yield* Effect.tryPromise(
                async () =>
                  await client.graphql(deleteAddress, {
                    accessToken: current.token,
                    variables: { id: previous.id },
                  })
              ).pipe(Effect.mapError(() => uncertain(reference)));
              if ((result.errors?.length ?? 0) > 0) {
                return yield* uncertain(reference);
              }
              const removed = yield* Schema.decodeUnknownEffect(RemovedAddress)(
                result.data?.removed
              ).pipe(Effect.mapError(() => uncertain(reference)));
              if (
                removed.userErrors.length &&
                removed.deletedAddressId === null
              ) {
                return yield* Effect.fail(
                  rejected(
                    removed.userErrors.some(
                      ({ code }) =>
                        code === "DELETING_CUSTOMER_DEFAULT_ADDRESS_NOT_ALLOWED"
                    )
                  )
                );
              }
              if (
                removed.userErrors.length ||
                removed.deletedAddressId !== previous.id
              ) {
                return yield* uncertain(reference);
              }
              return;
            }
            if (before.defaultId === previous.id) {
              return;
            }
            const result = yield* Effect.tryPromise(
              async () =>
                await client.graphql(updateAddress, {
                  accessToken: current.token,
                  variables: { id: previous.id, defaultAddress: true },
                })
            ).pipe(Effect.mapError(() => uncertain(reference)));
            if ((result.errors?.length ?? 0) > 0) {
              return yield* uncertain(reference);
            }
            const saved = yield* Schema.decodeUnknownEffect(SavedAddress)(
              result.data?.saved
            ).pipe(Effect.mapError(() => uncertain(reference)));
            if (saved.userErrors.length && saved.customerAddress === null) {
              return yield* Effect.fail(rejected());
            }
            if (
              saved.userErrors.length ||
              saved.customerAddress?.id !== previous.id
            ) {
              return yield* uncertain(reference);
            }
            const after = yield* list(
              operation,
              current.token,
              current.customer.id
            ).pipe(Effect.mapError(() => uncertain(reference)));
            if (after.defaultId !== previous.id) {
              return yield* uncertain(reference);
            }
          }
        ),
      });
    })
  );
export const customerAddressBookLayer = Layer.suspend(() =>
  customerAddressBookLayerWith({ environment: customerAccountKeys() })
);
