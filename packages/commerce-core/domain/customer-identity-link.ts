import { AuthUserId } from "@repo/auth-contract/access-token";
import { AuthUserKey } from "@repo/auth-contract/user-input";
import { Schema } from "effect";

import { CommerceCustomerId, CustomerKey } from "./customer";

/** A declarative relationship; a destination must enforce its identity-linking policy. */
export const CustomerIdentityLinkInput = Schema.Struct({
  authUserKey: AuthUserKey,
  customerKey: CustomerKey,
});
export type CustomerIdentityLinkInput = typeof CustomerIdentityLinkInput.Type;
export const CustomerIdentityLink = Schema.Struct({
  authUserId: AuthUserId,
  customerId: CommerceCustomerId,
});
export type CustomerIdentityLink = typeof CustomerIdentityLink.Type;
