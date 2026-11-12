import { NextCommerce } from "@repo/commerce-core/bindings";
import type { ProductDiscovery } from "@repo/commerce-core/product/product-discovery";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { Locale } from "@repo/i18n/types";
import type { Effect } from "effect";
import { connection } from "next/server";

/** Product queries need a buying context and discovery, not the checkout runtime. */
export interface CatalogRuntimeBinding {
  readonly run: <A, E>(
    locale: Locale,
    program: Effect.Effect<A, E, CommerceContext | ProductDiscovery>
  ) => Promise<A>;
}

/** The reference storefront reuses its full Commerce runtime. */
export const CatalogRuntime: CatalogRuntimeBinding = {
  run: async (locale, program) => {
    await connection();
    return await NextCommerce.runPromise(
      program.pipe(NextCommerce.provide(locale))
    );
  },
};
