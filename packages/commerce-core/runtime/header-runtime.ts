import { NextCommerce } from "@repo/commerce-core/bindings";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { Locale } from "@repo/i18n/types";
import type { Effect } from "effect";

import type { CurrentCart } from "../services/current-cart";

export type HeaderCommerceServices = CommerceContext | CurrentCart;

/** Header reads do not need checkout, registration, or payment services. */
export interface HeaderCommerceRuntimeBinding {
  readonly run: <A, E>(
    locale: Locale,
    program: Effect.Effect<A, E, HeaderCommerceServices>
  ) => Promise<A>;
}

/** The reference storefront supplies these services through its full runtime. */
export const HeaderCommerceRuntime: HeaderCommerceRuntimeBinding = {
  run: async (locale, program) =>
    await NextCommerce.runPromise(program.pipe(NextCommerce.provide(locale))),
};
