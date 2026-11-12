import { graphql } from "../../graphql";

export const ProductCollectionBlock = graphql(`
  fragment ProductCollectionBlock on LandingPageComponents @_unmask {
    ... on LandingPageComponentsDynamicProductCollection {
      DynamicProductCollection: dynamic_product_collection {
        heading
        limit
        description {
          json
        }
        product_category
      }
    }
  }
`);
