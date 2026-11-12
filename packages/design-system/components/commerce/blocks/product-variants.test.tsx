import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import ProductVariant from "./product-variants";
import type {
  ProductVariantProps,
  VariantItem,
  VariantSelectionPayload,
} from "./product-variants";

const roots: ReturnType<typeof createRoot>[] = [];
const variant = (value: string, label: string, price: number): VariantItem => ({
  currencyCode: "USD",
  id: value,
  isInStock: true,
  label,
  price,
  value,
});

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === text
  );
  if (element === undefined) {
    throw new Error(`Missing button: ${text}`);
  }
  return element;
}

function mount(props: ProductVariantProps) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = (next: ProductVariantProps) => {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en-US"
          messages={messages}
          timeZone="UTC"
          formats={{
            number: { wholeMoneyWithCurrency: { style: "currency" } },
          }}
        >
          <ProductVariant defaultImage="/test-product.png" {...next} />
        </NextIntlClientProvider>
      );
    });
  };
  render(props);
  return render;
}

describe("Product variant selection", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });
  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(["controlled", "uncontrolled"])(
    "submits the displayed default when a %s selection is no longer present",
    (mode) => {
      const onAddToCart = vi.fn<(payload: VariantSelectionPayload) => void>();
      const render = mount({
        initialVariant: "old-variant",
        onAddToCart,
        selectedVariant: mode === "controlled" ? "old-variant" : undefined,
        variants: [variant("old-variant", "Old", 10)],
      });
      render({
        initialVariant: "new-default",
        onAddToCart,
        selectedVariant: mode === "controlled" ? "old-variant" : undefined,
        variants: [
          variant("new-first", "First", 20),
          variant("new-default", "Default", 30),
        ],
      });

      expect(
        document.querySelector('[role="radio"][data-state="checked"]')?.id
      ).toBe("new-default");
      act(() => {
        button("Add to Cart").click();
      });
      expect(onAddToCart).toHaveBeenCalledWith(
        expect.objectContaining({
          price: 30,
          variantId: "new-default",
          variantLabel: "Default",
        })
      );
    }
  );

  it("keeps equally labelled variants distinct by their IDs", () => {
    const onAddToCart = vi.fn<(payload: VariantSelectionPayload) => void>();
    mount({
      onAddToCart,
      variants: [
        variant("first", "Same label", 10),
        variant("second", "Same label", 20),
      ],
    });
    const second = document.querySelector<HTMLButtonElement>('[id="second"]');
    if (second === null) {
      throw new Error("Missing second variant");
    }
    act(() => {
      second.click();
    });
    act(() => {
      button("Add to Cart").click();
    });
    expect(onAddToCart).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 20,
        variantId: "second",
        variantLabel: "Same label",
      })
    );
  });
});
