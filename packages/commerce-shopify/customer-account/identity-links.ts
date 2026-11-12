import "server-only";
import type { AuthUserId } from "@repo/auth-contract/access-token";
import { CommerceCustomerId } from "@repo/commerce-core/domain/commerce-account";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { Effect, Option, Schema } from "effect";

import { decodeCompanyResource, ShopifyCompanyAdmin } from "../company/admin";
import { ShopifyCustomerSessionFailure } from "./failure";
import { claimIdentity, identityKey, IdentityLink } from "./identity-records";

export { claimIdentity, identityKey, IdentityLink } from "./identity-records";

const CustomerIdentity = Schema.Struct({
  customerByIdentifier: Schema.NullOr(
    Schema.Struct({
      id: CommerceCustomerId,
      identityProviderSubjects: Schema.Array(
        Schema.Struct({
          providerName: Schema.NullOr(Schema.String),
          subject: Schema.NonEmptyString,
        })
      ),
    })
  ),
});

const readIdentityLink = Effect.fn("Shopify.readIdentityLink")(function* (
  kind: "auth" | "customer",
  id: string
) {
  const records = yield* VersionedKeyValueStore;
  return yield* records
    .get(identityKey(kind, id), IdentityLink)
    .pipe(
      Effect.mapError(
        () => new ShopifyCustomerSessionFailure({ reason: "unavailable" })
      )
    );
});

/** The email locates a candidate. Only Shopify's recorded provider and subject prove ownership. */
export const findCustomerByIdentitySubject = Effect.fn(
  "Shopify.findCustomerByIdentitySubject"
)(function* ({
  authUserId,
  email,
  providerName,
}: {
  readonly authUserId: AuthUserId;
  readonly email: string;
  readonly providerName: string;
}) {
  const admin = yield* ShopifyCompanyAdmin;
  const response = yield* admin.request(
    `query CustomerIdentitySubject($email: String!) {
      customerByIdentifier(identifier: {emailAddress: $email}) {
        id
        identityProviderSubjects { providerName subject }
      }
    }`,
    { email }
  );
  const { customerByIdentifier: customer } = yield* decodeCompanyResource(
    CustomerIdentity,
    response
  );
  if (
    customer?.identityProviderSubjects.some(
      (identity) =>
        identity.providerName === providerName &&
        identity.subject === authUserId
    )
  ) {
    const reverse = yield* readIdentityLink("customer", customer.id);
    if (
      Option.isSome(reverse) &&
      (reverse.value.value.authUserId !== authUserId ||
        reverse.value.value.customerId !== customer.id)
    ) {
      return yield* new ShopifyCustomerSessionFailure({
        reason: "identityMismatch",
      });
    }
    return customer.id;
  }
  return undefined;
});

export const findLinkedCustomerId = Effect.fn("Shopify.findLinkedCustomerId")(
  function* (authUserId: AuthUserId) {
    const link = yield* readIdentityLink("auth", authUserId);
    if (Option.isNone(link)) {
      return undefined;
    }
    if (link.value.value.authUserId !== authUserId) {
      return yield* new ShopifyCustomerSessionFailure({
        reason: "identityMismatch",
      });
    }
    return CommerceCustomerId.make(link.value.value.customerId);
  }
);

/** Call only after independently authenticating the site user and native customer. */
export const ensureCustomerIdentity = ({
  authUserId,
  customerId,
  mayCreate,
}: {
  readonly authUserId: string;
  readonly customerId: string;
  readonly mayCreate: boolean;
}) =>
  Effect.gen(function* () {
    const records = yield* VersionedKeyValueStore;
    const byAuth = yield* records.get(
      identityKey("auth", authUserId),
      IdentityLink
    );
    const byCustomer = yield* records.get(
      identityKey("customer", customerId),
      IdentityLink
    );
    const known = [byAuth, byCustomer].flatMap(Option.toArray);
    if (
      known.some(
        ({ value }) =>
          value.authUserId !== authUserId || value.customerId !== customerId
      ) ||
      (known.length === 0 && !mayCreate)
    ) {
      return yield* new ShopifyCustomerSessionFailure({
        reason: "identityMismatch",
      });
    }
    if (known.length === 2) {
      return;
    }
    // Complete a partial first claim on retry; neither direction may ever be rebound.
    yield* claimIdentity({ authUserId, customerId });
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "ShopifyCustomerSessionFailure"
        ? error
        : new ShopifyCustomerSessionFailure({
            reason:
              error._tag === "CommerceCustomerEmailConflict"
                ? "identityMismatch"
                : "unavailable",
          })
    )
  );
