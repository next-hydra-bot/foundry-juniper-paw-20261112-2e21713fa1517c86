import { AuthUserId } from "@repo/auth-contract/access-token";
import { Schema } from "effect";

import { VariantId } from "../product/identity";
import { StoreKey } from "../store";
import {
  CommerceBusinessUnitId,
  CommerceBusinessUnitKey,
} from "./commerce-account";

export const ShoppingListId = Schema.NonEmptyString.pipe(
  Schema.brand("ShoppingListId")
);
export type ShoppingListId = typeof ShoppingListId.Type;
export const ShoppingListLineItemId = Schema.NonEmptyString.pipe(
  Schema.brand("ShoppingListLineItemId")
);
export type ShoppingListLineItemId = typeof ShoppingListLineItemId.Type;
export const ShoppingListRevision = Schema.NonEmptyString.pipe(
  Schema.brand("ShoppingListRevision")
);
export type ShoppingListRevision = typeof ShoppingListRevision.Type;
export const ShoppingListPurpose = Schema.Literals(["shopping", "favorites"]);
export type ShoppingListPurpose = typeof ShoppingListPurpose.Type;
export const ShoppingListLocale = Schema.String.check(
  Schema.isPattern(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)
);
export const ShoppingListText = Schema.Record(
  ShoppingListLocale,
  Schema.NonEmptyString
).check(
  Schema.makeFilter((value) => Object.keys(value).length > 0, {
    expected: "at least one localized value",
  })
);
export const ShoppingListQuantity = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);
/** Verified site identity; provider customer IDs are resolved inside native adapters. */
export const ShoppingListBuyer = Schema.Struct({
  authUserId: AuthUserId,
  businessUnit: Schema.optional(
    Schema.Struct({ id: CommerceBusinessUnitId, key: CommerceBusinessUnitKey })
  ),
});
export type ShoppingListBuyer = typeof ShoppingListBuyer.Type;

export const ShoppingListOwnership = Schema.Union([
  Schema.TaggedStruct("Customer", { authUserId: AuthUserId }),
  Schema.TaggedStruct("BusinessUnit", {
    businessUnitId: CommerceBusinessUnitId,
    authUserId: Schema.optional(AuthUserId),
  }),
]);
export type ShoppingListOwnership = typeof ShoppingListOwnership.Type;
export const ShoppingListItemDraft = Schema.Struct({
  variantId: VariantId,
  quantity: ShoppingListQuantity,
});
export const ShoppingListLineItem = Schema.Struct({
  ...ShoppingListItemDraft.fields,
  id: ShoppingListLineItemId,
  addedAt: Schema.Date,
});
export const ShoppingListDraft = Schema.Struct({
  storeKey: StoreKey,
  purpose: Schema.optional(ShoppingListPurpose),
  name: ShoppingListText,
  description: Schema.optional(ShoppingListText),
  items: Schema.Array(ShoppingListItemDraft),
});
const header = {
  id: ShoppingListId,
  revision: ShoppingListRevision,
  storeKey: StoreKey,
  purpose: ShoppingListPurpose,
  ownership: ShoppingListOwnership,
  name: ShoppingListText,
  description: Schema.optional(ShoppingListText),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  createdBy: Schema.optional(AuthUserId),
  updatedBy: Schema.optional(AuthUserId),
};
export const ShoppingList = Schema.Struct({
  ...header,
  items: Schema.Array(ShoppingListLineItem),
});
export type ShoppingList = typeof ShoppingList.Type;
export const ShoppingListSummary = Schema.Struct({
  ...header,
  itemCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ShoppingListSummary = typeof ShoppingListSummary.Type;
export const ShoppingListPage = Schema.Struct({
  items: Schema.Array(ShoppingListSummary),
  nextCursor: Schema.optional(Schema.NonEmptyString),
});
export type ShoppingListPage = typeof ShoppingListPage.Type;
export const ShoppingListTarget = Schema.Struct({
  id: ShoppingListId,
  storeKey: StoreKey,
});
export type ShoppingListTarget = typeof ShoppingListTarget.Type;
/** Favorites are found by purpose within the acting Customer and explicit Store/company scope. */
export const ShoppingListReadInput = Schema.Union([
  ShoppingListTarget,
  Schema.Struct({ purpose: Schema.Literal("favorites"), storeKey: StoreKey }),
]);
export type ShoppingListReadInput = typeof ShoppingListReadInput.Type;
export const ShoppingListAction = Schema.Union([
  Schema.TaggedStruct("SetName", {
    locale: ShoppingListLocale,
    value: Schema.NonEmptyString,
  }),
  Schema.TaggedStruct("SetDescription", {
    locale: ShoppingListLocale,
    value: Schema.NullOr(Schema.NonEmptyString),
  }),
  Schema.TaggedStruct("AddItem", { ...ShoppingListItemDraft.fields }),
  Schema.TaggedStruct("SetQuantity", {
    lineItemId: ShoppingListLineItemId,
    quantity: ShoppingListQuantity,
  }),
  Schema.TaggedStruct("RemoveItem", { lineItemId: ShoppingListLineItemId }),
]);
export const UpdateShoppingListInput = Schema.Struct({
  ...ShoppingListTarget.fields,
  expectedRevision: ShoppingListRevision,
  actions: Schema.NonEmptyArray(ShoppingListAction),
});
export type UpdateShoppingListInput = typeof UpdateShoppingListInput.Type;
export const DeleteShoppingListInput = Schema.Struct({
  ...ShoppingListTarget.fields,
  expectedRevision: ShoppingListRevision,
});
export type DeleteShoppingListInput = typeof DeleteShoppingListInput.Type;
export const ListShoppingListsInput = Schema.Struct({
  storeKey: StoreKey,
  ownership: Schema.Literals(["mine", "others", "all"]),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  cursor: Schema.optional(Schema.NonEmptyString),
});
export type ListShoppingListsInput = typeof ListShoppingListsInput.Type;
export class ShoppingListFailure extends Schema.TaggedError<ShoppingListFailure>()(
  "ShoppingListFailure",
  {
    operation: Schema.Literals(["list", "get", "create", "update", "delete"]),
    reason: Schema.Literals([
      "notFound",
      "conflict",
      "accessDenied",
      "invalidInput",
      "limitExceeded",
      "unavailable",
      "invalidData",
      "outcomeUnknown",
    ]),
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  }
) {}
