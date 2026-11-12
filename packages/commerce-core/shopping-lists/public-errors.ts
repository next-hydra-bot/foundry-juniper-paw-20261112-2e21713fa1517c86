import { ErrorCategory, ErrorRecovery } from "@repo/errors";
import { Schema } from "effect";

import { ShoppingListFailure } from "../domain/shopping-list";

const failureMetadata = {
  accessDenied: {
    category: "forbidden",
    message: "This shopping list action is not permitted.",
    recovery: "request_access",
  },
  conflict: {
    category: "conflict",
    message: "The shopping list changed. Refresh before saving.",
    recovery: "refresh",
  },
  invalidInput: {
    category: "bad_input",
    message: "Check the shopping list input.",
    recovery: "fix_input",
  },
  limitExceeded: {
    category: "bad_input",
    message:
      "The shopping list cannot contain more items. Remove an item before adding another.",
    recovery: "fix_input",
  },
  notFound: {
    category: "not_found",
    message: "The shopping list is no longer available.",
    recovery: "refresh",
  },
  outcomeUnknown: {
    category: "unavailable",
    message: "The change could not be confirmed. Refresh before trying again.",
    recovery: "refresh",
  },
  unavailable: {
    category: "unavailable",
    message: "Shopping lists are temporarily unavailable.",
    recovery: "retry",
  },
} as const;

export const ShoppingListPublicFailure = Schema.TaggedStruct(
  "ShoppingListFailure",
  {
    category: ErrorCategory,
    code: Schema.Literal("shoppingList.failed"),
    message: Schema.String,
    operation: ShoppingListFailure.fields.operation,
    reason: ShoppingListFailure.fields.reason,
    recovery: ErrorRecovery,
  }
);
export type ShoppingListPublicFailure = typeof ShoppingListPublicFailure.Type;

/** Safe transport-neutral projection shared by HTTP and Action adapters. */
export const toPublicShoppingListFailure = (
  error: ShoppingListFailure
): ShoppingListPublicFailure => {
  if (error.reason === "invalidData") {
    throw error;
  }
  return {
    _tag: "ShoppingListFailure",
    code: "shoppingList.failed",
    operation: error.operation,
    reason: error.reason,
    ...failureMetadata[error.reason],
  };
};
