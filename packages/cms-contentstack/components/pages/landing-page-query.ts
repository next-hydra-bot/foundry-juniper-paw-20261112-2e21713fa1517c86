import { graphql } from "../../graphql";
import { HeroSectionBlock } from "../blocks/hero-section-fragment";
import { ProductCollectionBlock } from "../blocks/product-collection-fragment";
import { RichTextBlock } from "../blocks/rich-text-fragment";

export const landingPageQuery = graphql(
  `
    query PageQuery($url: String, $locale: String!) {
      all_landing_page(
        locale: $locale
        fallback_locale: true
        limit: 1
        where: { url: $url }
      ) {
        items {
          title
          display_title
          hide_display_title
          url
          components {
            __typename
            ...HeroSectionBlock
            ...RichTextBlock
            ...ProductCollectionBlock
          }
          system {
            uid
            content_type_uid
            locale
          }
        }
      }
    }
  `,
  [HeroSectionBlock, RichTextBlock, ProductCollectionBlock]
);
