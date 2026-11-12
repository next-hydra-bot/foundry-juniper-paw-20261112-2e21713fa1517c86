"use server";

import { Actions } from "@repo/commerce-b2c/bindings";
import { Schema } from "effect";

import { selectB2CPurchasingProgram } from "./programs";

const selectB2CPurchasingAction = Actions.procedure(
  "PurchasingContext.selectB2C"
)
  .input(Schema.Null)
  .output(Schema.Null)
  .error(Schema.Never)
  .handle(selectB2CPurchasingProgram)
  .toAction();

export const selectB2CPurchasing = async (): Promise<void> => {
  await selectB2CPurchasingAction(null);
};
