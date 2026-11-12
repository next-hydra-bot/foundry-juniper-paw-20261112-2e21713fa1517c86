import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { CommerceContext } from "../services/commerce-context";
import { CommerceLocale, Store, StoreKey } from "../store";
import { ProductDiscovery } from "./product-discovery";
import { makePublicCatalogRuntime } from "./public-catalog-runtime";

describe("Public catalog runtime", () => {
  it.effect("uses only the selected Store and an anonymous principal", () =>
    Effect.gen(function* () {
      const runtime = makePublicCatalogRuntime(ProductDiscovery.testLayer());
      const context = yield* Effect.promise(
        async () =>
          await runtime.run(
            new Store({
              currency: "EUR",
              locale: CommerceLocale.make("fr-FR"),
              storeKey: StoreKey.make("test-france"),
            }),
            Effect.gen(function* () {
              return yield* CommerceContext;
            })
          )
      );
      expect(context.store.currency).toBe("EUR");
      expect(context.store.locale).toBe("fr-FR");
      expect(context.principal._tag).toBe("AnonymousCommercePrincipal");
      const result = yield* context.customerPrincipal().pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    })
  );
});
