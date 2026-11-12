import type { CustomerIdentityLink } from "@repo/commerce-core/domain/customer-identity-link";
import { Effect } from "effect";
import { DestinationError } from "migrate-sdk";
import type { Tracking } from "migrate-sdk";

import type { CatalogAdmin } from "../catalog/admin";
import { claimIdentity } from "../customer-account/identity-records";
import { provisioningStorage } from "./storage";
/** Only explicit administrator-owned, key-resolved source relations reach this destination. */
export const makeIdentityLinkDestination =
  (admin: CatalogAdmin<Tracking>) => (input: CustomerIdentityLink) =>
    claimIdentity(input).pipe(
      Effect.provide(provisioningStorage("identities", admin)),
      Effect.as(input),
      Effect.mapError(
        () =>
          new DestinationError({
            message:
              "Shopify Customer identity conflicts or could not be persisted. Use the same Shopify app as the runtime.",
          })
      )
    );
