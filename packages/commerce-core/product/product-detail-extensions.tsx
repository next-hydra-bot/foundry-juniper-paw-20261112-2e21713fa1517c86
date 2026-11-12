import type { Locale } from "@repo/i18n/types";
import type { ReactNode } from "react";

import type { ProductDetailPresentation } from "./presentation";

export interface ProductDetailExtensionProps {
  readonly locale: Locale;
  readonly product: ProductDetailPresentation;
}
const extensions: readonly ((
  props: ProductDetailExtensionProps
) => ReactNode | Promise<ReactNode>)[] = [];
export const ProductDetailExtensions = (props: ProductDetailExtensionProps) => (
  <>
    {extensions.map((Extension) => (
      <Extension {...props} key={Extension.name} />
    ))}
  </>
);
