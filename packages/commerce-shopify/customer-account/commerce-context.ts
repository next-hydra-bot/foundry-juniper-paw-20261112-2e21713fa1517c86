import {
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AnonymousCommercePrincipal,
  B2CPurchasingPrincipal,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer, Redacted } from "effect";

import { ShopifyCustomerAccounts } from "./accounts";

const noPrincipal = () =>
  Effect.fail(
    new CommerceRequestContextNotFound({
      message: "The buyer has no Shopify customer session",
      reason: "noPrincipal",
    })
  );

/** WorkOS authority alone never becomes Shopify customer authority. */
export const b2cPurchasingContextLayer = (request: CommerceContextRequest) =>
  Layer.effect(
    CommerceContext,
    Effect.gen(function* () {
      if (request._tag === "CustomerCommerceContextRequest") {
        return yield* new CommerceRequestContextNotFound({
          message: "Shopify B2B purchasing is not configured",
          reason: "noBuyingContext",
        });
      }
      const accounts = yield* ShopifyCustomerAccounts;
      const identity = yield* accounts.read.pipe(
        Effect.mapError(
          () =>
            new CommerceRequestContextNotFound({
              message: "The Shopify customer session could not be read",
              reason: "noCustomerMapping",
            })
        )
      );
      if (request._tag === "AnonymousCommerceContextRequest" || !identity) {
        return CommerceContext.of({
          customerPrincipal: noPrincipal,
          customerProfile: noPrincipal,
          principal: new AnonymousCommercePrincipal({}),
          store: request.store,
        });
      }
      if (identity.authUserId !== request.authUserId) {
        return yield* new CommerceRequestContextNotFound({
          message: "The Shopify customer does not match the site session",
          reason: "noCustomerMapping",
        });
      }
      const customerId = CommerceCustomerId.make(identity.customer.id);
      const principal = new B2CPurchasingPrincipal({
        authUserId: request.authUserId,
        customerId,
      });
      const profile = accounts.profile.pipe(
        Effect.map(
          (customer) =>
            new CommerceCustomerProfile({
              customerId,
              email: Redacted.make(customer.email, { label: "email" }),
              firstName:
                customer.firstName === null
                  ? undefined
                  : Redacted.make(customer.firstName, {
                      label: "personName",
                    }),
              lastName:
                customer.lastName === null
                  ? undefined
                  : Redacted.make(customer.lastName, {
                      label: "personName",
                    }),
            })
        ),
        Effect.mapError(
          () =>
            new CommerceAccountUnavailable({
              message: "Shopify customer details could not be read.",
            })
        )
      );
      return CommerceContext.of({
        customerPrincipal: () => Effect.succeed(principal),
        customerProfile: () => profile,
        principal,
        store: request.store,
      });
    })
  );
