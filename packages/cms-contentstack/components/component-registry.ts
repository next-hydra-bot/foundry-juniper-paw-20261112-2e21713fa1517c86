import { DynamicProductCollection } from "./blocks/dynamic-product-collection";
import { HeroSection } from "./blocks/hero-section";
import { RichText } from "./blocks/rich-text";

export const componentMap = {
  HeroSection,
  RichText,
  DynamicProductCollection,
} as const;

export const componentFragments = Object.values(componentMap).map(
  (component) => component.fragment
);
