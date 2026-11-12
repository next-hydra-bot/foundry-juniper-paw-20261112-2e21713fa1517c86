import { AuthUserId } from "@repo/auth-contract/access-token";
import { Schema } from "effect";

export { AuthUserId } from "@repo/auth-contract/access-token";

import { Store } from "../store";
import { CartId } from "./cart";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
  CompanyRoles,
  CommerceCustomerId,
} from "./commerce-account";

export class AnonymousCommerceContextRequest extends Schema.TaggedClass<AnonymousCommerceContextRequest>()(
  "AnonymousCommerceContextRequest",
  {
    anonymousCartId: Schema.optional(CartId),
    store: Store,
  }
) {}

export class CustomerCommerceContextRequest extends Schema.TaggedClass<CustomerCommerceContextRequest>()(
  "CustomerCommerceContextRequest",
  {
    authUserId: AuthUserId,
    businessUnitId: Schema.optional(CommerceBusinessUnitId),
    store: Store,
  }
) {}

/** A verified authentication identity buying for itself, without a company selector. */
export class B2CPurchasingContextRequest extends Schema.TaggedClass<B2CPurchasingContextRequest>()(
  "B2CPurchasingContextRequest",
  { authUserId: AuthUserId, store: Store }
) {}

export const CommerceContextRequest = Schema.Union([
  AnonymousCommerceContextRequest,
  CustomerCommerceContextRequest,
  B2CPurchasingContextRequest,
]);
export type CommerceContextRequest = typeof CommerceContextRequest.Type;

export class AnonymousCommercePrincipal extends Schema.TaggedClass<AnonymousCommercePrincipal>()(
  "AnonymousCommercePrincipal",
  {
    anonymousCartId: Schema.optional(CartId),
  }
) {}

export class CustomerCommercePrincipal extends Schema.TaggedClass<CustomerCommercePrincipal>()(
  "CustomerCommercePrincipal",
  {
    authUserId: AuthUserId,
    businessUnitId: CommerceBusinessUnitId,
    businessUnitKey: CommerceBusinessUnitKey,
    customerId: CommerceCustomerId,
    roles: CompanyRoles,
  }
) {}

export class B2CPurchasingPrincipal extends Schema.TaggedClass<B2CPurchasingPrincipal>()(
  "B2CPurchasingPrincipal",
  { authUserId: AuthUserId, customerId: CommerceCustomerId }
) {}

export const AuthenticatedCommercePrincipal = Schema.Union([
  CustomerCommercePrincipal,
  B2CPurchasingPrincipal,
]);
export type AuthenticatedCommercePrincipal =
  typeof AuthenticatedCommercePrincipal.Type;

export const CommercePrincipal = Schema.Union([
  AnonymousCommercePrincipal,
  CustomerCommercePrincipal,
  B2CPurchasingPrincipal,
]);
export type CommercePrincipal = typeof CommercePrincipal.Type;

export class CommerceRequestContextNotFound extends Schema.TaggedError<CommerceRequestContextNotFound>()(
  "CommerceRequestContextNotFound",
  {
    message: Schema.String,
    reason: Schema.Literals([
      "noPrincipal",
      "noCustomerMapping",
      "noBuyingContext",
    ]),
  }
) {}
