import { graphql } from "../../graphql";

export const HeroSectionBlock = graphql(`
  fragment HeroSectionBlock on LandingPageComponents @_unmask {
    ... on LandingPageComponentsHeroSection {
      HeroSection: hero_section {
        tagline
        title
        description {
          json
        }
        imageConnection {
          edges {
            node {
              ... on SysAsset {
                url
                dimension {
                  width
                  height
                }
              }
            }
          }
        }
        image_alt
        cta {
          label
          internal_contentConnection {
            edges {
              node {
                ... on LandingPage {
                  url
                  title
                }
              }
            }
          }
          external_url
        }
      }
    }
  }
`);
