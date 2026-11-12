import type { Layer } from "effect";
import { Effect } from "effect";

import {
  AnonymousCommercePrincipal,
  CommerceRequestContextNotFound,
} from "../domain/commerce-request-context";
import { CommerceContext } from "../services/commerce-context";
import type { Store } from "../store";
import type { ProductDiscovery } from "./product-discovery";

/** Public catalog operations have no customer, cart, cookie or session inputs. */
export interface PublicCatalogBinding {
  readonly productCacheLife: "hours" | "max";
  readonly run: <A, E>(
    store: Store,
    program: Effect.Effect<A, E, ProductDiscovery | CommerceContext>
  ) => Promise<A>;
}

const unavailable = () =>
  Effect.fail(
    new CommerceRequestContextNotFound({
      message: "The public catalog has no customer identity",
      reason: "noPrincipal",
    })
  );

export const makePublicCatalogRuntime = <E>(
  discovery: Layer.Layer<ProductDiscovery, E, CommerceContext>,
  productCacheLife: PublicCatalogBinding["productCacheLife"] = "max"
): PublicCatalogBinding => ({
  productCacheLife,
  run: async (store, program) => {
    const context = CommerceContext.of({
      customerPrincipal: unavailable,
      customerProfile: unavailable,
      principal: new AnonymousCommercePrincipal({}),
      store,
    });
    return await Effect.runPromise(
      program.pipe(
        Effect.provide(discovery),
        Effect.provideService(CommerceContext, context)
      )
    );
  },
});
