import {
  AnonymousCommercePrincipal,
  CommerceRequestContextNotFound,
  B2CPurchasingPrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import type {
  CommerceContextRequest,
  AuthenticatedCommercePrincipal,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer } from "effect";

const noPrincipal = () =>
  Effect.fail(
    new CommerceRequestContextNotFound({
      message: "An anonymous buyer has no authenticated Customer",
      reason: "noPrincipal",
    })
  );

export const b2cPurchasingContextLayer = (request: CommerceContextRequest) =>
  Layer.effect(
    CommerceContext,
    Effect.gen(function* () {
      if (request._tag === "CustomerCommerceContextRequest") {
        return yield* new CommerceRequestContextNotFound({
          message: "Personal purchasing does not accept a company selector",
          reason: "noBuyingContext",
        });
      }
      const accounts = yield* CommerceAccounts;
      if (request._tag === "AnonymousCommerceContextRequest") {
        return CommerceContext.of({
          customerPrincipal: noPrincipal,
          customerProfile: noPrincipal,
          principal: new AnonymousCommercePrincipal({
            anonymousCartId: request.anonymousCartId,
          }),
          store: request.store,
        });
      }
      const customerId = yield* accounts
        .getCustomerIdByAuthUserId(request.authUserId)
        .pipe(
          Effect.catchTag(
            "CommerceCustomerIdNotFound",
            () =>
              new CommerceRequestContextNotFound({
                message:
                  "Commerce customer mapping does not exist for the authenticated user",
                reason: "noCustomerMapping",
              })
          )
        );
      const principal = new B2CPurchasingPrincipal({
        authUserId: request.authUserId,
        customerId,
      });
      return CommerceContext.of({
        customerPrincipal: (): Effect.Effect<AuthenticatedCommercePrincipal> =>
          Effect.succeed(principal),
        customerProfile: () => accounts.getCustomerProfile(customerId),
        principal,
        store: request.store,
      });
    })
  );

/** Guest-only purchasing requires no provider customer or company capabilities. */
export const guestB2CPurchasingContextLayer = (
  request: CommerceContextRequest
) =>
  Layer.effect(
    CommerceContext,
    request._tag === "AnonymousCommerceContextRequest"
      ? Effect.succeed(
          CommerceContext.of({
            customerPrincipal: noPrincipal,
            customerProfile: noPrincipal,
            principal: new AnonymousCommercePrincipal({
              anonymousCartId: request.anonymousCartId,
            }),
            store: request.store,
          })
        )
      : Effect.fail(
          new CommerceRequestContextNotFound({
            message: "Authenticated purchasing is not configured",
            reason: "noCustomerMapping",
          })
        )
  );
