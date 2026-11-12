import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductDetail } from "./product-detail";

describe(ProductDetail, () => {
  it("renders product content and dialog slots without commerce state", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <ProductDetail
          title="Test product"
          categoryName="Equipment"
          dialogs={<aside>Custom enquiry</aside>}
        >
          <button type="button">Custom purchase controls</button>
        </ProductDetail>
      </NextIntlClientProvider>
    );

    expect(markup).toContain("Equipment");
    expect(markup).toContain("Test product");
    expect(markup).toContain("Custom purchase controls");
    expect(markup).toContain("Custom enquiry");
  });
});
