import { Context } from "effect";
import type { Effect, Option } from "effect";

import type {
  ShoppingListBuyer,
  DeleteShoppingListInput,
  ListShoppingListsInput,
  ShoppingList,
  ShoppingListDraft,
  ShoppingListFailure,
  ShoppingListPage,
  ShoppingListReadInput,
  UpdateShoppingListInput,
} from "../domain/shopping-list";

/**
 * Saved lists, scoped on every operation to the verified buyer and explicit Store.
 * The composed B2C/B2B Layer authorizes each operation; storage Layers supply
 * scoped persistence underneath that same service. Customer reads exclude
 * company lists; company reads require the selected Business Unit. Missing and
 * out-of-scope IDs both return None (or notFound for writes).
 * Revisions are opaque. Updates apply all actions atomically; stale writes fail.
 * AddItem increments an existing variant, SetQuantity replaces its quantity.
 * List summaries are newest-created first. Cursors never establish authority.
 * Prices and purchasability belong to current catalog/cart reads, not this store.
 */
export class ShoppingLists extends Context.Service<
  ShoppingLists,
  {
    readonly list: (
      principal: ShoppingListBuyer,
      input: ListShoppingListsInput
    ) => Effect.Effect<ShoppingListPage, ShoppingListFailure>;
    readonly get: (
      principal: ShoppingListBuyer,
      input: ShoppingListReadInput
    ) => Effect.Effect<Option.Option<ShoppingList>, ShoppingListFailure>;
    readonly create: (
      principal: ShoppingListBuyer,
      draft: typeof ShoppingListDraft.Type
    ) => Effect.Effect<ShoppingList, ShoppingListFailure>;
    readonly update: (
      principal: ShoppingListBuyer,
      input: UpdateShoppingListInput
    ) => Effect.Effect<ShoppingList, ShoppingListFailure>;
    readonly delete: (
      principal: ShoppingListBuyer,
      input: DeleteShoppingListInput
    ) => Effect.Effect<void, ShoppingListFailure>;
  }
>()("@repo/commerce-core/ShoppingLists") {}
