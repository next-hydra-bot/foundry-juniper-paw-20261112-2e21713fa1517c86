import { Context } from "effect";
import type { Effect, Option } from "effect";

import type { CartCookie } from "./schema";

/** Private provider credentials. Web cookies and HTTP sessions supply this interface. */
export class ShopifyCartPersistence extends Context.Service<
  ShopifyCartPersistence,
  {
    readonly read: (
      key: string
    ) => Effect.Effect<Option.Option<typeof CartCookie.Type>>;
    readonly write: (
      key: string,
      cart: typeof CartCookie.Type
    ) => Effect.Effect<void>;
    readonly clear: (key: string) => Effect.Effect<void>;
  }
>()("@repo/commerce-shopify/CartPersistence") {}
