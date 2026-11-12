import { Layer } from "effect";

import { CurrentCart } from "../services/current-cart";
import type { CommerceRequestInput } from "./commerce-request";
import type { CommerceContextLayer } from "./make-commerce-base-app";

/** Request services for the header, independent of checkout and payments. */
export function makeHeaderCommerceLayer(
  request: CommerceRequestInput,
  commerceContextLayer: CommerceContextLayer
) {
  return CurrentCart.layer(request.currentCartCookie).pipe(
    Layer.provideMerge(commerceContextLayer(request.context))
  );
}
