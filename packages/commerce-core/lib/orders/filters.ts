import { DateTime, Schema } from "effect";

import { OrderFilters } from "../../domain/order-history";
import type { OrderSummary } from "../../domain/order-history";

/** Stable field order and UTC encoding make equivalent selections share a cursor context. */
export const encodeOrderFilters = (filters?: OrderFilters) =>
  Schema.encodeSync(OrderFilters)(filters ?? {});

/** Applied after authorization; this predicate never establishes access to an Order. */
export const matchesOrderFilters = (
  order: OrderSummary,
  filters?: OrderFilters
) =>
  !filters ||
  ((!filters.number || order.number === filters.number) &&
    (!filters.purchaseOrderNumber ||
      order.purchaseOrderNumber === filters.purchaseOrderNumber) &&
    (!filters.createdFrom ||
      !DateTime.isLessThan(order.createdAt, filters.createdFrom)) &&
    (!filters.createdBefore ||
      DateTime.isLessThan(order.createdAt, filters.createdBefore)) &&
    (!filters.payment || order.status.payment === filters.payment) &&
    (!filters.fulfillment ||
      order.status.fulfillment === filters.fulfillment) &&
    (!filters.cancellation ||
      order.status.cancellation === filters.cancellation));
