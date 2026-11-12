import { OrderQueryFailure } from "@repo/commerce-core/domain/order-history";
import type {
  FindOrderDetailInput,
  ListOrdersInput,
} from "@repo/commerce-core/domain/order-history";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { Effect } from "effect";

const reader = (operation: "list" | "findById") =>
  Effect.gen(function* () {
    const { principal } = yield* CommerceContext;
    if (principal._tag !== "B2CPurchasingPrincipal") {
      return yield* new OrderQueryFailure({
        message: "Sign in as a customer to view orders.",
        operation,
        reason: "accessDenied",
      });
    }
    return principal;
  });
export const listOrders = Effect.fn("CustomerOrders.list")(function* (
  input: ListOrdersInput
) {
  const principal = yield* reader("list");
  const queries = yield* OrderQueries;
  return yield* queries.list(principal, input);
});
export const findOrderDetail = Effect.fn("CustomerOrders.findById")(function* (
  input: FindOrderDetailInput
) {
  const principal = yield* reader("findById");
  const queries = yield* OrderQueries;
  return yield* queries.findById(principal, input);
});
