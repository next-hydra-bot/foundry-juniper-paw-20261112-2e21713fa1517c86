import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  CustomerCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Redacted } from "effect";

import { ShopifyCustomerAccounts } from "../customer-account/accounts";
import type { ShopifyCustomerIdentity } from "../customer-account/accounts";

export const companyCustomerIdentity: ShopifyCustomerIdentity = {
  accessToken: Redacted.make("customer-token"),
  authUserId: "site-user",
  cartSynchronizationPending: false,
  customer: {
    email: "buyer@example.com",
    firstName: "Buyer",
    id: "gid://shopify/Customer/1",
    lastName: "Example",
  },
  scope: "site-session",
};
export const customerAccountFixture = (
  identity: ShopifyCustomerIdentity | undefined = companyCustomerIdentity
) =>
  Layer.succeed(ShopifyCustomerAccounts, {
    cartAccessToken: identity?.accessToken
      ? Effect.succeed(identity.accessToken)
      : Effect.die("A customer token is required"),
    accountDestination: () => Effect.succeed(undefined),
    checkoutDestination: () => Effect.succeed(undefined),
    completeCartSynchronization: Effect.void,
    refreshProfile:
      identity === undefined
        ? Effect.die("A customer identity is required")
        : Effect.succeed(identity.customer),
    handle: () => Effect.succeed({ destination: "/", synchronizeCart: false }),
    read: Effect.succeed(identity),
    profile:
      identity === undefined
        ? Effect.die("A customer identity is required")
        : Effect.succeed(identity.customer),
  });
export const companyContextFixture = (
  companyLocationId = "gid://shopify/CompanyLocation/1"
) => {
  const principal = new CustomerCommercePrincipal({
    authUserId: AuthUserId.make(companyCustomerIdentity.authUserId),
    businessUnitId: CommerceBusinessUnitId.make(companyLocationId),
    businessUnitKey: CommerceBusinessUnitKey.make(companyLocationId),
    customerId: CommerceCustomerId.make(companyCustomerIdentity.customer.id),
    roles: ["buyer"],
  });
  return Layer.succeed(CommerceContext, {
    customerPrincipal: () => Effect.succeed(principal),
    customerProfile: () => Effect.die("Profile is unused in this fixture"),
    principal,
    store: resolveStore({ locale: CommerceLocale.make("en-US") }),
  });
};
