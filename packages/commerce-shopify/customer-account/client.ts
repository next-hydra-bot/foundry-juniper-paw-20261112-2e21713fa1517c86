import { createShopifyRequestContext } from "@shopify/hydrogen";
import {
  createCustomerAccountClient,
  CustomerAccountApiError,
  CustomerAccountAuthenticationError,
  gql,
} from "@shopify/hydrogen/customer-account";
import { Effect, Schema } from "effect";

import type { storefrontContext } from "../store";
import { ShopifyCustomerSessionFailure } from "./failure";

const customerQuery = gql(
  `query CurrentCustomer { customer { id firstName lastName emailAddress { emailAddress } } }`
);
const CustomerResponse = Schema.Struct({
  customer: Schema.Struct({
    emailAddress: Schema.Struct({ emailAddress: Schema.NonEmptyString }),
    firstName: Schema.NullOr(Schema.String),
    id: Schema.NonEmptyString,
    lastName: Schema.NullOr(Schema.String),
  }),
});

class NativeCustomerUnauthenticatedError extends Error {
  override name = "NativeCustomerUnauthenticatedError";
}

/** Verify the token with Shopify; never select a customer by caller-supplied ID or email. */
export const readCustomerProfile = ({
  accessToken,
  i18n,
  request,
  shopId,
  fetchApi = globalThis.fetch,
}: {
  readonly accessToken: string;
  readonly i18n: ReturnType<typeof storefrontContext>;
  readonly request: { readonly headers: Headers; readonly url: string };
  readonly shopId: string;
  readonly fetchApi?: typeof globalThis.fetch;
}) =>
  Effect.tryPromise({
    catch: (cause) =>
      new ShopifyCustomerSessionFailure({
        reason:
          cause instanceof NativeCustomerUnauthenticatedError ||
          cause instanceof CustomerAccountAuthenticationError ||
          (cause instanceof CustomerAccountApiError &&
            (cause.status === 401 || cause.status === 403))
            ? "unauthenticated"
            : "unavailable",
      }),
    try: async (signal) => {
      const client = createCustomerAccountClient({
        fetch: async (input, init) =>
          await fetchApi(input, { ...init, cache: "no-store" }),
        requestContext: createShopifyRequestContext({ i18n, request }),
        shopId,
      });
      const result = await client.graphql(customerQuery, {
        accessToken,
        signal,
      });
      if (
        result.errors?.some(
          (error) =>
            error.extensions?.code === "UNAUTHENTICATED" ||
            error.extensions?.code === "ACCESS_DENIED"
        )
      ) {
        throw new NativeCustomerUnauthenticatedError();
      }
      if ((result.errors?.length ?? 0) > 0) {
        throw new Error("Customer profile unavailable");
      }
      const { customer } = Schema.decodeUnknownSync(CustomerResponse)(
        result.data
      );
      return {
        email: customer.emailAddress.emailAddress,
        firstName: customer.firstName,
        id: customer.id,
        lastName: customer.lastName,
      };
    },
  });
