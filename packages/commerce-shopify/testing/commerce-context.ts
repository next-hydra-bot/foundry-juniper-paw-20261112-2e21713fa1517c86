import {
  AnonymousCommercePrincipal,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { AnonymousCommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer } from "effect";

export const guestCommerceContextLayer = (
  request: AnonymousCommerceContextRequest
) =>
  Layer.succeed(CommerceContext, {
    customerPrincipal: () =>
      Effect.fail(
        new CommerceRequestContextNotFound({
          message: "Guest fixture",
          reason: "noPrincipal",
        })
      ),
    customerProfile: () =>
      Effect.fail(
        new CommerceRequestContextNotFound({
          message: "Guest fixture",
          reason: "noPrincipal",
        })
      ),
    principal: new AnonymousCommercePrincipal({}),
    store: request.store,
  });
