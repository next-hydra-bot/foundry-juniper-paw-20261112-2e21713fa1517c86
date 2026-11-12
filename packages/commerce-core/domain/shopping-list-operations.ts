import type { AuthUserId } from "@repo/auth-contract/access-token";
import { Effect, Schema } from "effect";

import {
  ShoppingListAction,
  ShoppingListFailure,
  ShoppingListLineItemId,
} from "./shopping-list";
import type {
  ShoppingListBuyer,
  ShoppingList,
  ShoppingListOwnership,
  ShoppingListTarget,
} from "./shopping-list";

export const shoppingListOwnership = (
  principal: ShoppingListBuyer
): ShoppingListOwnership =>
  principal.businessUnit === undefined
    ? { _tag: "Customer", authUserId: principal.authUserId }
    : {
        _tag: "BusinessUnit",
        businessUnitId: principal.businessUnit.id,
        authUserId: principal.authUserId,
      };

export const ownsShoppingList = (
  principal: ShoppingListBuyer,
  input: Pick<ShoppingListTarget, "storeKey">,
  list: ShoppingList
) =>
  list.storeKey === input.storeKey &&
  (principal.businessUnit === undefined
    ? list.ownership._tag === "Customer" &&
      list.ownership.authUserId === principal.authUserId
    : list.ownership._tag === "BusinessUnit" &&
      list.ownership.businessUnitId === principal.businessUnit.id);

export const changeShoppingList = Effect.fn("ShoppingLists.change")(function* (
  current: ShoppingList,
  actions: readonly (typeof ShoppingListAction.Type)[],
  actor: AuthUserId,
  now: Date
) {
  let next: ShoppingList = {
    ...current,
    items: [...current.items],
    updatedBy: actor,
    updatedAt: now,
  };
  for (const action of actions) {
    switch (action._tag) {
      case "SetName":
        next = {
          ...next,
          name: { ...next.name, [action.locale]: action.value },
        };
        break;
      case "SetDescription": {
        const description = { ...next.description };
        if (action.value === null) delete description[action.locale];
        else description[action.locale] = action.value;
        const { description: _, ...rest } = next;
        next = Object.keys(description).length
          ? { ...rest, description }
          : rest;
        break;
      }
      case "AddItem": {
        const existing = next.items.find(
          (item) => item.variantId === action.variantId
        );
        const quantity = (existing?.quantity ?? 0) + action.quantity;
        if (!Number.isSafeInteger(quantity)) {
          return yield* new ShoppingListFailure({
            operation: "update",
            reason: "invalidInput",
            message: "The requested quantity is too large.",
          });
        }
        next = {
          ...next,
          items: existing
            ? next.items.map((item) =>
                item.id === existing.id ? { ...item, quantity } : item
              )
            : [
                ...next.items,
                {
                  id: ShoppingListLineItemId.make(
                    yield* Effect.sync(() => crypto.randomUUID())
                  ),
                  variantId: action.variantId,
                  quantity,
                  addedAt: now,
                },
              ],
        };
        break;
      }
      case "SetQuantity":
      case "RemoveItem":
        if (!next.items.some((item) => item.id === action.lineItemId)) {
          return yield* new ShoppingListFailure({
            operation: "update",
            reason: "notFound",
            message: "The saved line no longer exists.",
          });
        }
        next = {
          ...next,
          items:
            action._tag === "RemoveItem"
              ? next.items.filter((item) => item.id !== action.lineItemId)
              : next.items.map((item) =>
                  item.id === action.lineItemId
                    ? { ...item, quantity: action.quantity }
                    : item
                ),
        };
        break;
    }
  }
  return next;
});

const Cursor = Schema.Struct({
  id: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
});
export const shoppingListCursor = (list: {
  readonly id: string;
  readonly createdAt: Date;
}) => JSON.stringify({ id: list.id, createdAt: list.createdAt.toISOString() });
export const readShoppingListCursor = (cursor: string | undefined) =>
  cursor === undefined
    ? Effect.succeed(undefined)
    : Schema.decodeUnknownEffect(Schema.fromJsonString(Cursor))(cursor).pipe(
        Effect.mapError(
          (cause) =>
            new ShoppingListFailure({
              cause,
              operation: "list",
              reason: "invalidInput",
              message: "The shopping list cursor is invalid.",
            })
        )
      );
