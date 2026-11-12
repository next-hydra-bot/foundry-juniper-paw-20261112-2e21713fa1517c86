import {
  NoUnusedFragmentsRule,
  parse,
  UniqueFragmentNamesRule,
  visit,
  visitInParallel,
} from "graphql";
import { ASTValidationContext } from "graphql/validation/ValidationContext";
import { describe, expect, it } from "vitest";

import {
  addLinesMutation,
  cartQuery,
  createCartMutation,
  removeLinesMutation,
  updateBuyerMutation,
  updateLinesMutation,
  setStoreAttributionMutation,
} from "../cart/graphql";
import {
  collectionProductsQuery,
  productQuery,
  productsQuery,
  variantsQuery,
} from "../product/graphql";

const documents = {
  addLinesMutation,
  cartQuery,
  collectionProductsQuery,
  createCartMutation,
  productQuery,
  productsQuery,
  removeLinesMutation,
  setStoreAttributionMutation,
  updateBuyerMutation,
  updateLinesMutation,
  variantsQuery,
};

describe("composed Storefront GraphQL documents", () => {
  it.each(Object.entries(documents))(
    "%s defines each referenced fragment exactly once",
    (_name, query) => {
      const document = parse(query);
      const errors: string[] = [];
      const context = new ASTValidationContext(document, (error) => {
        errors.push(error.message);
      });
      visit(
        document,
        visitInParallel([
          UniqueFragmentNamesRule(context),
          NoUnusedFragmentsRule(context),
          {
            FragmentSpread(node) {
              if (context.getFragment(node.name.value) === undefined) {
                errors.push(`Missing fragment ${node.name.value}`);
              }
            },
          },
        ])
      );

      expect(errors).toEqual([]);
    }
  );
});
