import { CommerceBusinessUnitId } from "@repo/commerce-core/domain/commerce-account";
import { CommerceLocale, storeConfiguration } from "@repo/commerce-core/store";
import { Schema } from "effect";

export class CommerceRequestHeaders extends Schema.Class<CommerceRequestHeaders>(
  "CommerceRequestHeaders"
)({
  "x-context-business-unit-id": Schema.optional(CommerceBusinessUnitId),
  "x-context-locale": CommerceLocale.check(
    Schema.makeFilter(
      (locale) => storeConfiguration.some((store) => store.locale === locale),
      { expected: "a locale with a configured Store" }
    )
  ),
  "x-context-purchasing-context": Schema.optional(
    Schema.Literals(["personal", "company"])
  ),
}) {}
