import { createHash } from "node:crypto";

import { CustomerIdentityLink } from "@repo/commerce-core/domain/customer-identity-link";
import {
  CommerceAccountUnavailable,
  CommerceCustomerEmailConflict,
} from "@repo/commerce-core/services/commerce-accounts";
import {
  VersionedKeyValueStore,
  VersionedStoreKey,
} from "@repo/versioned-store";
import { Effect, Option, Schema } from "effect";

export const IdentityLink = Schema.toEncoded(CustomerIdentityLink);
export const identityKey = (kind: "auth" | "customer", id: string) =>
  VersionedStoreKey.make(
    `${kind}.${createHash("sha256").update(id).digest("hex")}`
  );
const conflict = () =>
  new CommerceCustomerEmailConflict({
    message: "This customer is already linked to another identity",
  });

export const claimIdentity = (link: typeof IdentityLink.Type) =>
  Effect.gen(function* () {
    const identities = yield* VersionedKeyValueStore;
    for (const key of [
      identityKey("customer", link.customerId),
      identityKey("auth", link.authUserId),
    ]) {
      const existing = yield* identities.get(key, IdentityLink);
      if (Option.isSome(existing)) {
        if (
          existing.value.value.authUserId !== link.authUserId ||
          existing.value.value.customerId !== link.customerId
        ) {
          return yield* conflict();
        }
        continue;
      }
      yield* identities
        .insert(key, IdentityLink, link)
        .pipe(
          Effect.catchTag("StoreConflict", () =>
            identities
              .get(key, IdentityLink)
              .pipe(
                Effect.flatMap((current) =>
                  Option.isSome(current) &&
                  current.value.value.authUserId === link.authUserId &&
                  current.value.value.customerId === link.customerId
                    ? Effect.void
                    : Effect.fail(conflict())
                )
              )
          )
        );
    }
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "CommerceCustomerEmailConflict"
        ? error
        : new CommerceAccountUnavailable({
            message:
              "Shopify customer identity could not be linked; retry acceptance",
          })
    )
  );
