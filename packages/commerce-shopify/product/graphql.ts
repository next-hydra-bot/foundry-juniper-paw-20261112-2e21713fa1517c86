import { gql } from "@shopify/hydrogen";

import { commerceAttributesFragment } from "./attribute-graphql";

const productCard = gql(`fragment ProductCard on Product {
  id handle title description availableForSale
  featuredImage { url altText }
  priceRange { minVariantPrice { amount currencyCode } }
  priceVariants: variants(first:250) { nodes { price { amount currencyCode } compareAtPrice { amount currencyCode } } pageInfo { hasNextPage endCursor } }
}`);

export const cardPriceVariantsQuery =
  gql(`query CardPriceVariants($id:ID!, $after:String!, $country:CountryCode!, $language:LanguageCode!, $buyer:BuyerInput) @inContext(country:$country, language:$language, buyer:$buyer) {
  node(id:$id) { ... on Product { id priceVariants: variants(first:250, after:$after) { nodes { price { amount currencyCode } compareAtPrice { amount currencyCode } } pageInfo { hasNextPage endCursor } } } }
}`);
const variant = gql(
  `fragment ProductVariantFields on ProductVariant {
  id sku availableForSale currentlyNotInStock quantityAvailable
  image { url altText }
  gallery: metafield(namespace: "commerce", key: "variantImages") {
    references(first:250) { nodes { __typename ... on MediaImage { image { url altText } } } pageInfo { hasNextPage } }
  }
  price { amount currencyCode }
  compareAtPrice { amount currencyCode }
  selectedOptions { name value }
  ...CommerceAttributes
}`,
  [commerceAttributesFragment]
);

// The variant document already includes CommerceAttributes; append it only once.
export const productQuery = gql(
  `
  query Product($attributeIdentifiers: [HasMetafieldsIdentifier!]!, $handle: String!, $country: CountryCode!, $language: LanguageCode!, $buyer: BuyerInput)
  @inContext(country: $country, language: $language, buyer: $buyer) {
    product(handle: $handle) {
      id handle title description featuredImage { url altText }
      optionBindings: metafield(namespace: "commerce_shopify", key: "optionBindings") { type value }
      options { id name optionValues { id name swatch { color image { previewImage { url altText } } } } }
      ...CommerceAttributes
      collections(first:250) { nodes { id title handle seedCatalog:metafield(namespace:"commerce",key:"seedCatalog") { value } seedCategory:metafield(namespace:"commerce",key:"seedCategory") { value } } pageInfo { hasNextPage } }
      variants(first: 250) {
        nodes { ...ProductVariantFields }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`,
  [variant]
);

export const variantsQuery = gql(
  `
  query Variants($attributeIdentifiers: [HasMetafieldsIdentifier!]!, $id: ID!, $after: String!, $country: CountryCode!, $language: LanguageCode!, $buyer: BuyerInput)
  @inContext(country: $country, language: $language, buyer: $buyer) {
    node(id: $id) {
      __typename
      ... on Product {
        variants(first: 250, after: $after) {
          nodes { ...ProductVariantFields }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }`,
  [variant]
);

export const productsQuery = gql(
  `
  query Products($first: Int!, $after: String, $country: CountryCode!, $language: LanguageCode!, $buyer: BuyerInput)
  @inContext(country: $country, language: $language, buyer: $buyer) {
    products(first: $first, after: $after) {
      nodes { ...ProductCard }
      pageInfo { hasNextPage endCursor }
    }
  }`,
  [productCard]
);

export const collectionProductsQuery = gql(
  `
  query CollectionProducts($categoryId: ID!, $first: Int!, $after: String, $country: CountryCode!, $language: LanguageCode!, $buyer: BuyerInput)
  @inContext(country: $country, language: $language, buyer: $buyer) {
    collection(id: $categoryId) {
      products(first: $first, after: $after) {
        nodes { ...ProductCard }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`,
  [productCard]
);

export const variantCardsQuery = gql(`
  query VariantCards($ids: [ID!]!, $country: CountryCode!, $language: LanguageCode!, $buyer: BuyerInput)
  @inContext(country: $country, language: $language, buyer: $buyer) {
    nodes(ids: $ids) {
      __typename
      ... on ProductVariant {
        id sku availableForSale
        image { url altText }
        selectedOptions { name value }
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        product { id handle title featuredImage { url altText } }
      }
    }
  }
`);
