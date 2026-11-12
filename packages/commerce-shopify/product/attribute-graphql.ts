import { gql } from "@shopify/hydrogen";

export const commerceAttributesFragment =
  gql(`fragment CommerceAttributes on HasMetafields {
  metafields(identifiers: $attributeIdentifiers) { key type value }
}`);
