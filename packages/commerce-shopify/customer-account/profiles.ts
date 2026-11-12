import "server-only";
import {
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CustomerProfiles } from "@repo/commerce-core/services/customer-profiles";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { routing } from "@repo/i18n/routing";
import { createShopifyRequestContext } from "@shopify/hydrogen";
import {
  createCustomerAccountClient,
  gql,
} from "@shopify/hydrogen/customer-account";
import { Effect, Layer, Redacted, Schema } from "effect";

import { storefrontContext } from "../store";
import { ShopifyCustomerAccounts } from "./accounts";
import { customerAccountKeys } from "./keys";

const saveProfile =
  gql(`mutation CustomerProfileSave($input:CustomerUpdateInput!) {
  customerUpdate(input:$input) { customer { id } userErrors { message } }
}`);
const SavedProfile = Schema.Struct({
  customerUpdate: Schema.Struct({
    customer: Schema.NullOr(Schema.Struct({ id: Schema.NonEmptyString })),
    userErrors: Schema.Array(Schema.Struct({ message: Schema.String })),
  }),
});
const unavailable = () =>
  new CommerceAccountUnavailable({
    message:
      "Customer details could not be saved. Refresh your account before trying again.",
  });

export const customerProfilesLayerWith = ({
  environment,
  fetchApi = globalThis.fetch,
}: {
  readonly environment: ReturnType<typeof customerAccountKeys>;
  readonly fetchApi?: typeof globalThis.fetch;
}) =>
  Layer.effect(
    CustomerProfiles,
    Effect.gen(function* () {
      const accounts = yield* ShopifyCustomerAccounts;
      const client = createCustomerAccountClient({
        fetch: async (input, init) =>
          await fetchApi(input, { ...init, cache: "no-store" }),
        shopId: environment.SHOPIFY_SHOP_ID,
        requestContext: createShopifyRequestContext({
          i18n: storefrontContext(
            resolveStore({ locale: CommerceLocale.make(routing.defaultLocale) })
          ),
          request: {
            headers: new Headers(),
            url: environment.SHOPIFY_STOREFRONT_ORIGIN,
          },
        }),
      });
      return CustomerProfiles.of({
        save: (identity, names) =>
          Effect.gen(function* () {
            const token = yield* accounts.cartAccessToken;
            const current = yield* accounts.read;
            if (
              !current ||
              current.authUserId !== identity.authUserId ||
              current.customer.email.toLowerCase() !==
                Redacted.value(identity.email).toLowerCase()
            ) {
              return yield* unavailable();
            }
            yield* accounts.profile;
            const result = yield* Effect.tryPromise(
              async () =>
                await client.graphql(saveProfile, {
                  accessToken: Redacted.value(token),
                  variables: {
                    input: {
                      firstName: Redacted.value(names.firstName),
                      lastName: Redacted.value(names.lastName),
                    },
                  },
                })
            );
            if ((result.errors?.length ?? 0) > 0) {
              return yield* unavailable();
            }
            const saved = yield* Schema.decodeUnknownEffect(SavedProfile)(
              result.data
            );
            if (
              saved.customerUpdate.userErrors.length ||
              saved.customerUpdate.customer?.id !== current.customer.id
            ) {
              return yield* unavailable();
            }
            const customer = yield* accounts.refreshProfile;
            if (customer.id !== current.customer.id) {
              return yield* unavailable();
            }
            return new CommerceCustomerProfile({
              customerId: CommerceCustomerId.make(customer.id),
              email: Redacted.make(customer.email, { label: "email" }),
              firstName:
                customer.firstName === null
                  ? undefined
                  : Redacted.make(customer.firstName, { label: "personName" }),
              lastName:
                customer.lastName === null
                  ? undefined
                  : Redacted.make(customer.lastName, { label: "personName" }),
            });
          }).pipe(Effect.mapError(unavailable)),
      });
    })
  );

export const customerProfilesLayer = Layer.suspend(() =>
  customerProfilesLayerWith({ environment: customerAccountKeys() })
);
