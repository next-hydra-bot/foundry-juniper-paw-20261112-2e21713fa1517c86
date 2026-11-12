import type { ShoppingListBuyer } from "@repo/commerce-core/domain/shopping-list";
import { ShoppingListFailure } from "@repo/commerce-core/domain/shopping-list";
import { ShoppingLists } from "@repo/commerce-core/services/shopping-lists";
import { Effect, Layer } from "effect";

const customer = (
  principal: ShoppingListBuyer,
  operation: ShoppingListFailure["operation"]
) =>
  principal.businessUnit === undefined
    ? Effect.succeed(principal)
    : Effect.fail(
        new ShoppingListFailure({
          operation,
          reason: "accessDenied",
          message:
            "Customer shopping lists require a customer purchasing context.",
        })
      );

/** Decorates the supplied storage implementation; buyer and Store remain method inputs. */
export const shoppingListsAuthorizationLayer = Layer.effect(
  ShoppingLists,
  Effect.gen(function* () {
    const lists = yield* ShoppingLists;
    return ShoppingLists.of({
      list: Effect.fn("CustomerShoppingLists.list")(
        function* (principal, input) {
          return yield* lists.list(yield* customer(principal, "list"), input);
        }
      ),
      get: Effect.fn("CustomerShoppingLists.get")(function* (principal, input) {
        return yield* lists.get(yield* customer(principal, "get"), input);
      }),
      create: Effect.fn("CustomerShoppingLists.create")(
        function* (principal, input) {
          return yield* lists.create(
            yield* customer(principal, "create"),
            input
          );
        }
      ),
      update: Effect.fn("CustomerShoppingLists.update")(
        function* (principal, input) {
          return yield* lists.update(
            yield* customer(principal, "update"),
            input
          );
        }
      ),
      delete: Effect.fn("CustomerShoppingLists.delete")(
        function* (principal, input) {
          return yield* lists.delete(
            yield* customer(principal, "delete"),
            input
          );
        }
      ),
    });
  })
);

/** Recipe composition retains the base services and replaces ShoppingLists with its authorized implementation. */
export const withShoppingListAuthorization = <Services, Error, Requirements>(
  base: Layer.Layer<Services, Error, Requirements>
) => shoppingListsAuthorizationLayer.pipe(Layer.provideMerge(base));
