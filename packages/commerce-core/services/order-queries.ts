import { Context } from "effect";
import type { Effect, Option } from "effect";

import type { AuthenticatedCommercePrincipal } from "../domain/commerce-request-context";
import type { EmailOrderAccess } from "../domain/order-access";
import type {
  FindOrderDetailInput,
  ListOrdersInput,
  OrderDetail,
  OrderPage,
  OrderQueryFailure,
} from "../domain/order-history";

export type OrderDetailPrincipal =
  | AuthenticatedCommercePrincipal
  | EmailOrderAccess;

/**
 * Reads historical Orders for explicit query selections and verified authority.
 *
 * B2C excludes company purchases, including those placed by the same Customer.
 * B2B includes only the selected Business Unit, after domain permission checks.
 * Hosts resolve and authorize the principal before calling this seam; submitted
 * customer IDs never establish authority. Provider Layers capture clients, not
 * request identity or selectors. Adapters enforce resource scope and the explicit
 * Store selection on every read. Locale affects presentation only; it never
 * selects a Store or converts historical currency. Unsupported Store filtering
 * fails explicitly rather than returning an unfiltered result.
 * SingleStore filters recorded Store of origin. Orders without attribution can
 * appear in AllStores within the authorized buyer scope, never in SingleStore.
 * EmailOrderAccess permits only findById for its personal Order, original Store
 * and still-matching recorded recipient. It never authorizes list or company reads.
 * Filters combine with AND and never replace ownership or Store constraints.
 * A bounded backend scan may return fewer matches and a continuation; only the
 * absence of nextCursor proves the end of the available filtered history.
 * A known provider access window is reported through OrderPage.historyLimitDays.
 */
export class OrderQueries extends Context.Service<
  OrderQueries,
  {
    /** Newest created first. No exact total or native query syntax is promised. */
    readonly list: (
      principal: AuthenticatedCommercePrincipal,
      input: ListOrdersInput
    ) => Effect.Effect<OrderPage, OrderQueryFailure>;
    /** Missing and out-of-scope IDs both return None; lack of read permission fails. */
    readonly findById: (
      principal: OrderDetailPrincipal,
      input: FindOrderDetailInput
    ) => Effect.Effect<Option.Option<OrderDetail>, OrderQueryFailure>;
  }
>()("@repo/commerce-core/OrderQueries") {}
