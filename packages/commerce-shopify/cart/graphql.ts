import { gql } from "@shopify/hydrogen";

const discountApplication =
  gql(`fragment CartDiscountApplicationFields on BaseCartDiscountApplication {
  targetType totalAllocatedAmount { amount currencyCode }
  ... on CartAutomaticDiscountApplication { label: title }
  ... on CartCodeDiscountApplication { label: code }
  ... on CartCustomDiscountApplication { label: title }
}`);

const cart = gql(
  `fragment CartFields on Cart { id checkoutUrl totalQuantity
  discountCodes { code applicable }
  discountApplications { ...CartDiscountApplicationFields }
  storeAttribution: metafield(namespace: "commerce", key: "store_key") { type value } buyerIdentity { countryCode customer { id } purchasingCompany { company { id } location { id } } } cost { totalAmount { amount currencyCode } }
  lines(first: 250, after: $after) { nodes { id quantity
    discountAllocations { discountedAmount { amount currencyCode } sourceDiscountApplication { ...CartDiscountApplicationFields } }
    cost { amountPerQuantity { amount currencyCode } compareAtAmountPerQuantity { amount currencyCode } subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
    merchandise { ... on ProductVariant { id sku selectedOptions { name value } image { url altText } product { id title } } } } pageInfo { hasNextPage endCursor } } }`,
  [discountApplication]
);

export const updateDiscountCodesMutation = gql(
  `mutation cartDiscountCodesUpdate($id: ID!, $codes: [String!]!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartDiscountCodesUpdate(cartId: $id, discountCodes: $codes) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const cartQuery = gql(
  `query Cart($id: ID!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cart(id: $id) { ...CartFields } }`,
  [cart]
);

export const createCartMutation = gql(
  `mutation cartCreate($input: CartInput!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartCreate(input: $input) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const addLinesMutation = gql(
  `mutation cartLinesAdd($id: ID!, $lines: [CartLineInput!]!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartLinesAdd(cartId: $id, lines: $lines) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const updateLinesMutation = gql(
  `mutation cartLinesUpdate($id: ID!, $lines: [CartLineUpdateInput!]!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartLinesUpdate(cartId: $id, lines: $lines) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const removeLinesMutation = gql(
  `mutation cartLinesRemove($id: ID!, $lineIds: [ID!]!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartLinesRemove(cartId: $id, lineIds: $lineIds) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const updateBuyerMutation = gql(
  `mutation cartBuyerIdentityUpdate($id: ID!, $buyerIdentity: CartBuyerIdentityInput!, $after: String, $language: LanguageCode!) @inContext(language: $language) { cartBuyerIdentityUpdate(cartId: $id, buyerIdentity: $buyerIdentity) { cart { ...CartFields } userErrors { code field message } warnings { code message } } }`,
  [cart]
);

export const setStoreAttributionMutation = gql(
  `mutation cartStoreAttribution($metafields: [CartMetafieldsSetInput!]!) { cartMetafieldsSet(metafields: $metafields) { metafields { namespace key type value } userErrors { message } } }`
);
