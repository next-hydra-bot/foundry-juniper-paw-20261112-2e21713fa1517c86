import { b2cPurchasingContextLayer } from "@repo/commerce-b2c/commerce-context";
import { B2CPurchasingContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceContextLayer } from "@repo/commerce-core/runtime/make-commerce-base-app";
import { Effect, Layer } from "effect";

/** API requests require an explicit personal selector; otherwise retain company authority. */
export const makeExplicitPurchasingCommerceContextLayer =
  (companyCommerceContextLayer: CommerceContextLayer) =>
  (request: CommerceContextRequest) =>
    request._tag === "B2CPurchasingContextRequest"
      ? b2cPurchasingContextLayer(request)
      : companyCommerceContextLayer(request);

export const makePurchasingCommerceContextLayer =
  (companyCommerceContextLayer: CommerceContextLayer) =>
  (request: CommerceContextRequest) => {
    if (request._tag === "B2CPurchasingContextRequest") {
      return b2cPurchasingContextLayer(request);
    }
    return companyCommerceContextLayer(request).pipe(
      Layer.catch((error) =>
        error._tag === "CommerceRequestContextNotFound" &&
        error.reason === "noBuyingContext" &&
        request._tag === "CustomerCommerceContextRequest" &&
        request.businessUnitId === undefined
          ? b2cPurchasingContextLayer(
              new B2CPurchasingContextRequest({
                authUserId: request.authUserId,
                store: request.store,
              })
            )
          : Layer.effectContext(Effect.fail(error))
      )
    );
  };
