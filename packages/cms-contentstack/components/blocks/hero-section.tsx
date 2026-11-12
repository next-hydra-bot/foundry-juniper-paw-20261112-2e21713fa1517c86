import { HeroSection as HeroSectionComponent } from "@repo/design-system/components/cms/blocks/hero-section";
import type { Locale } from "@repo/i18n";

import type { ResultOf } from "../../graphql";
import { getNodesFromConnection } from "../../lib/utils/connection";
import { renderRichText } from "../../lib/utils/rich-text-utils";
import type { ComponentBaseProps } from "../../types";
import getLinkProps from "../link";
import { HeroSectionBlock } from "./hero-section-fragment";

type HeroSectionData = NonNullable<
  Extract<
    ResultOf<typeof HeroSectionBlock>,
    { HeroSection: unknown }
  >["HeroSection"]
>;

export function HeroSection(
  props: {
    data: HeroSectionData;
    locale: Locale;
  } & ComponentBaseProps
) {
  const { data, livePreviewHelper } = props;

  const livePreviewProps = livePreviewHelper?.getUIProps({
    cta: "cta",
    description: "description",
    image: "image",
    tagline: "tagline",
    title: "title",
  });

  const [image] = getNodesFromConnection(data.imageConnection).map((node) => ({
    altText: data.image_alt ?? "",
    height: node?.dimension?.height ?? undefined,
    url: node?.url ?? "",
    width: node?.dimension?.width ?? undefined,
  }));

  return (
    <HeroSectionComponent
      image={image}
      ctaLinks={getLinkProps(data.cta)}
      tagline={data.tagline ?? ""}
      title={data.title ?? ""}
      description={renderRichText(data.description?.json)}
      livePreviewProps={livePreviewProps}
    />
  );
}

HeroSection.fragment = HeroSectionBlock;
HeroSection.contentField = "hero_section";
