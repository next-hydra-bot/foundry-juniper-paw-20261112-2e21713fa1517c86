import type { Redacted, Effect, Option } from "effect";
import { Context } from "effect";

import type {
  EmailOrderAccess,
  OrderAccessToken,
} from "../domain/order-access";
import type { OrderQueryFailure } from "../domain/order-history";
import type { CommerceLocale } from "../store";

/** Issuing a link is privileged. Only links delivered to the recorded recipient establish access. */
export class OrderAccessLinks extends Context.Service<
  OrderAccessLinks,
  {
    readonly issue: (
      access: EmailOrderAccess,
      locale: CommerceLocale
    ) => Effect.Effect<Redacted.Redacted, OrderQueryFailure>;
    readonly verify: (
      token: OrderAccessToken
    ) => Effect.Effect<Option.Option<EmailOrderAccess>, OrderQueryFailure>;
  }
>()("@repo/commerce-core/OrderAccessLinks") {}
