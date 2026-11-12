import { Schema } from "effect";

import { CategoryKey, CategorySlug } from "./identity";
import { ProductCategory } from "./model";

export const ProductCategoryDetail = Schema.Struct({
  ...ProductCategory.fields,
  description: Schema.optional(Schema.String),
  key: CategoryKey,
  name: Schema.NonEmptyString,
  slug: CategorySlug,
});
export type ProductCategoryDetail = typeof ProductCategoryDetail.Type;
