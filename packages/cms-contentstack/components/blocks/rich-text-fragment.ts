import { graphql } from "../../graphql";

export const RichTextBlock = graphql(`
  fragment RichTextBlock on LandingPageComponents @_unmask {
    ... on LandingPageComponentsRichText {
      RichText: rich_text {
        body {
          json
        }
      }
    }
  }
`);
