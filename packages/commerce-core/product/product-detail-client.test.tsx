import type { ChangeCartDiscountCodeAction } from "@repo/commerce-core/cart/change-cart-discount-code";
import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { Schema } from "effect";
import { act, Activity, Suspense, use } from "react";
import type { ReactNode } from "react";
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

import type { AddToCartAction } from "../cart/add-to-cart";
import { CartProvider, useCart, useCartState } from "../cart/cart-context";
import type { ChangeCartItemsQuantityAction } from "../cart/change-cart-items-quantity";
import { CartPublicState } from "../cart/public-state";
import type { RemoveCartItemAction } from "../cart/remove-cart-item";
import { resolveProductSelection } from "./option-selection";
import type { ProductSelectionQuery } from "./option-selection";
import type {
  ProductDetailPresentation,
  ProductDetailVariantPresentation,
} from "./presentation";
import {
  CommerceProductDetail,
  CommerceProductMedia,
  CommerceProductPurchase,
  CommerceProductSelection,
} from "./product-detail-client";

const roots: ReturnType<typeof createRoot>[] = [];
const cartState = Schema.decodeSync(CartPublicState)({
  cart: {
    checkoutDetails: {},
    id: "cart-1",
    lineItems: [],
    status: "active",
    storeKey: "store-1",
    totalLineItemQuantity: 0,
    totalPrice: { centAmount: 0, currencyCode: "USD" },
  },
  violations: [],
});
const variant = (
  value: string,
  label: string,
  price: number
): ProductDetailVariantPresentation => ({
  currencyCode: "USD",
  id: value,
  isInStock: true,
  label,
  options: [],
  price,
  value,
});
const product = (productId: string): ProductDetailPresentation => ({
  availableForSale: true,
  defaultImage: "/test-product.png",
  defaultVariantId: "1",
  productId,
  title: productId,
  variantLabel: "Size",
  variants: [variant("1", "Small", 10), variant("2", "Large", 20)],
});

const optionProduct = (
  query: ProductSelectionQuery = {}
): ProductDetailPresentation => {
  const configured = {
    ...product("option-product"),
    defaultVariantId: "opaque:black-small",
    options: [
      {
        key: "size",
        label: "Size",
        values: [
          { key: "S", label: "Small", id: "value:small" },
          { key: "L", label: "Large", id: "value:large" },
        ],
      },
      {
        key: "color",
        label: "Color",
        values: [
          {
            key: "black",
            label: "Black",
            id: "value:black",
            swatch: { color: "#202124" },
          },
          {
            key: "blue",
            label: "Blue",
            id: "value:blue",
            swatch: { color: "#315D84" },
          },
        ],
      },
    ],
    variants: [
      {
        ...variant("opaque:black-small", "Small / Black", 10),
        optionValues: { size: "S", color: "black" },
        imageUrl: "/black-small.png",
      },
      {
        ...variant("opaque:blue-small", "Small / Blue", 20),
        optionValues: { size: "S", color: "blue" },
        imageUrl: "/blue-small.png",
        isInStock: false,
      },
      {
        ...variant("opaque:blue-large", "Large / Blue", 30),
        optionValues: { size: "L", color: "blue" },
        imageUrl: "/blue-large.png",
      },
    ],
  };
  return {
    ...configured,
    initialQuery: query,
    initialSelection: resolveProductSelection(configured, query),
  };
};

function CartState() {
  const { isOpen } = useCartState();
  const { currencyCode } = useCart();
  return <output data-cart-open={isOpen} data-cart-currency={currencyCode} />;
}

function button(text: string): HTMLButtonElement {
  const element = [...document.querySelectorAll("button")].find(
    (candidate) =>
      candidate.textContent === text ||
      candidate.getAttribute("aria-label") === text
  );
  if (element === undefined) {
    throw new Error(`Missing button: ${text}`);
  }
  return element;
}

function mount(addToCart: AddToCartAction) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const cartPromise = Promise.resolve(null);
  const actions = {
    addToCart,
    changeCartDiscountCode: vi.fn<ChangeCartDiscountCodeAction>(
      async () =>
        await Promise.resolve({
          _tag: "Success" as const,
          success: cartState,
        })
    ),
    changeCartItemsQuantity: vi
      .fn<ChangeCartItemsQuantityAction>()
      .mockResolvedValue({
        _tag: "Success",
        success: cartState,
      }),
    removeCartItem: vi.fn<RemoveCartItemAction>().mockResolvedValue({
      _tag: "Success",
      success: cartState,
    }),
  };
  return (
    next: ProductDetailPresentation,
    mode: "visible" | "hidden" = "visible",
    content?: ReactNode
  ) => {
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
          <CartProvider actions={actions} cartPromise={cartPromise}>
            <Activity mode={mode}>
              {content ?? <CommerceProductDetail {...next} />}
            </Activity>
            <CartState />
          </CartProvider>
        </NextIntlClientProvider>
      );
    });
  };
}

describe("Product detail cart actions", () => {
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
    window.history.replaceState(null, "", "/");
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("renders selected media while buyer pricing is pending and uses private prices when ready", async () => {
    window.history.replaceState(null, "", "/products/jacket?variant=2");
    const publicProduct = {
      ...product("streamed-product"),
      initialSelection: { optionValues: {}, variantId: "2" },
      variants: [
        variant("1", "Small", 10),
        { ...variant("2", "Large", 20), imageUrl: "/large.png" },
      ],
    };
    let resolveBuyer: (product: ProductDetailPresentation) => void;
    // oxlint-disable-next-line promise/avoid-new -- Control the server result consumed by React.use to verify streaming.
    const pending = new Promise<ProductDetailPresentation>((resolve) => {
      resolveBuyer = resolve;
    });
    function BuyerControls() {
      return <CommerceProductPurchase {...use(pending)} />;
    }
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: cartState });
    await act(async () => {
      mount(addToCart)(
        publicProduct,
        "visible",
        <CommerceProductSelection product={publicProduct}>
          <CommerceProductMedia product={publicProduct} />
          <Suspense fallback={<p>Loading buyer pricing</p>}>
            <BuyerControls />
          </Suspense>
        </CommerceProductSelection>
      );
      await Promise.resolve();
    });
    expect(document.querySelector("img")?.getAttribute("src")).toContain(
      "large.png"
    );
    expect(document.body.textContent).toContain("Loading buyer pricing");
    await act(async () => {
      resolveBuyer({
        ...publicProduct,
        variants: [variant("1", "Small", 7), variant("2", "Large", 14)],
      });
      await pending;
    });
    expect(document.body.textContent).toContain("$14");
    expect(document.querySelector("img")?.getAttribute("src")).toContain(
      "large.png"
    );
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({ quantity: 1, variantId: "2" });
  });

  it("uses the server-selected variant for its first render and add-to-cart payload", async () => {
    window.history.replaceState(null, "", "/products/jacket?variant=2");
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: cartState });
    mount(addToCart)({
      ...product("deep-linked-product"),
      initialSelection: { optionValues: {}, variantId: "2" },
    });
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe("2");
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({ quantity: 1, variantId: "2" });
  });

  it("preselects separate Size and Color controls from a partial option link and purchases the matching variant", async () => {
    window.history.replaceState(null, "", "/products/jacket?option.size=L");
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: cartState });
    mount(addToCart)(optionProduct({ "option.size": "L" }));
    expect(
      [
        ...document.querySelectorAll('[role="radio"][data-state="checked"]'),
      ].map((element) => element.getAttribute("aria-label"))
    ).toEqual(["Large", "Blue"]);
    expect(document.querySelector("img")?.getAttribute("src")).toContain(
      "blue-large.png"
    );
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({
      quantity: 1,
      variantId: "opaque:blue-large",
    });
  });

  it("preserves an unavailable combination until the buyer chooses a matching color", async () => {
    window.history.replaceState(
      null,
      "",
      "/products/jacket?country=US&utm_source=email#details"
    );
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: cartState });
    mount(addToCart)(optionProduct());
    act(() => {
      button("Large").click();
    });
    expect(button("Add to Cart").disabled).toBeTruthy();
    act(() => {
      button("Add to Cart").click();
    });
    expect(addToCart).not.toHaveBeenCalled();
    act(() => {
      button("Blue").click();
    });
    expect(button("Add to Cart").disabled).toBeFalsy();
    expect({
      query: Object.fromEntries(new URLSearchParams(window.location.search)),
      hash: window.location.hash,
    }).toEqual({
      query: {
        "option.size": "L",
        "option.color": "blue",
        country: "US",
        utm_source: "email",
      },
      hash: "#details",
    });
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({
      quantity: 1,
      variantId: "opaque:blue-large",
    });
  });

  it("retains a sold-out exact combination with purchasing disabled", () => {
    window.history.replaceState(
      null,
      "",
      "/products/jacket?option.size=S&option.color=blue"
    );
    mount(vi.fn<AddToCartAction>())(
      optionProduct({ "option.size": "S", "option.color": "blue" })
    );
    expect(
      [
        ...document.querySelectorAll('[role="radio"][data-state="checked"]'),
      ].map((element) => element.getAttribute("aria-label"))
    ).toEqual(["Small", "Blue"]);
    expect(button("Add to Cart").disabled).toBeTruthy();
  });

  it("restores option controls from browser history after a cached page is revealed", () => {
    window.history.replaceState(null, "", "/products/jacket");
    const render = mount(vi.fn<AddToCartAction>());
    const initial = optionProduct();
    render(initial);
    act(() => {
      button("Large").click();
      button("Blue").click();
    });
    render(initial, "hidden");
    act(() => {
      window.history.replaceState(
        null,
        "",
        "/products/jacket?option.size=S&option.color=black"
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    render(initial, "visible");
    expect(
      [
        ...document.querySelectorAll('[role="radio"][data-state="checked"]'),
      ].map((element) => element.getAttribute("aria-label"))
    ).toEqual(["Small", "Black"]);
  });

  it("uses provider-normalized option references for the initial native link", () => {
    window.history.replaceState(
      null,
      "",
      "/products/jacket?option_values=42,43&country=US"
    );
    mount(vi.fn<AddToCartAction>())(
      optionProduct({ option_values: "value:large,value:blue" })
    );
    expect(
      [
        ...document.querySelectorAll('[role="radio"][data-state="checked"]'),
      ].map((element) => element.getAttribute("aria-label"))
    ).toEqual(["Large", "Blue"]);
    expect(
      Object.fromEntries(new URLSearchParams(window.location.search))
    ).toEqual({ "option.size": "L", "option.color": "blue", country: "US" });
  });

  it("round-trips selection through the URL and browser history while retaining unrelated parameters", () => {
    window.history.replaceState(
      null,
      "",
      "/products/jacket?country=US&utm_source=orders"
    );
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: cartState });
    mount(addToCart)(product("jacket"));
    act(() => {
      button("Large").click();
    });
    expect(new URLSearchParams(window.location.search).get("variant")).toBe(
      "2"
    );
    expect(new URLSearchParams(window.location.search).get("country")).toBe(
      "US"
    );
    expect(new URLSearchParams(window.location.search).get("utm_source")).toBe(
      "orders"
    );
    act(() => {
      window.history.replaceState(null, "", "/products/jacket?variant=1");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe("1");
    act(() => {
      window.history.replaceState(null, "", "/products/jacket?variant=2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe("2");
  });

  it("normalizes a provider-resolved URL reference in place and restores it from history", () => {
    window.history.replaceState(
      null,
      "",
      "/products/jacket?variant=native-reference&country=US#details"
    );
    const resolvedVariantId = "opaque:variant:large";
    mount(
      vi.fn<AddToCartAction>().mockResolvedValue({
        _tag: "Success",
        success: cartState,
      })
    )({
      ...product("jacket"),
      initialSelection: { optionValues: {}, variantId: resolvedVariantId },
      initialQuery: { variant: resolvedVariantId },
      variants: [
        variant("1", "Small", 10),
        variant(resolvedVariantId, "Large", 20),
      ],
    });
    const location = new URL(window.location.href);
    expect({
      pathname: location.pathname,
      variant: location.searchParams.get("variant"),
      country: location.searchParams.get("country"),
      hash: location.hash,
    }).toEqual({
      pathname: "/products/jacket",
      variant: resolvedVariantId,
      country: "US",
      hash: "#details",
    });
    act(() => {
      button("Small").click();
    });
    act(() => {
      window.history.replaceState(null, "", location);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe(resolvedVariantId);
  });

  it.each(["1", "2"])(
    "restores URL variant %s when returning to a cached product page",
    async (restoredVariant) => {
      window.history.replaceState(null, "", "/products/jacket");
      const addToCart = vi.fn<AddToCartAction>().mockResolvedValue({
        _tag: "Success",
        success: cartState,
      });
      const render = mount(addToCart);
      const initial = {
        ...product("jacket"),
        initialSelection: { optionValues: {}, variantId: "1" },
      };
      render(initial);
      act(() => {
        button("Large").click();
      });
      render(initial, "hidden");
      act(() => {
        window.history.pushState(null, "", "/cart");
        window.history.replaceState(
          null,
          "",
          `/products/jacket?variant=${restoredVariant}`
        );
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      render(initial, "visible");
      expect({
        variant: new URLSearchParams(window.location.search).get("variant"),
        selected: document.querySelector('[role="radio"][data-state="checked"]')
          ?.id,
      }).toEqual({ variant: restoredVariant, selected: restoredVariant });
      await act(async () => {
        button("Add to Cart").click();
        await Promise.resolve();
      });
      expect(addToCart).toHaveBeenCalledWith({
        quantity: 1,
        variantId: restoredVariant,
      });
    }
  );

  it("accepts navigation to another URL variant of the same product", () => {
    const render = mount(
      vi
        .fn<AddToCartAction>()
        .mockResolvedValue({ _tag: "Success", success: cartState })
    );
    window.history.replaceState(null, "", "/products/jacket?variant=2");
    render({
      ...product("same-product"),
      initialSelection: { optionValues: {}, variantId: "2" },
    });
    window.history.replaceState(null, "", "/products/jacket?variant=1");
    render({
      ...product("same-product"),
      initialSelection: { optionValues: {}, variantId: "1" },
    });
    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe("1");
  });

  it("resets the variant and quantity for a different product even when variant IDs overlap", async () => {
    window.history.replaceState(null, "", "/products/first-product");
    const addToCart = vi.fn<AddToCartAction>().mockResolvedValue({
      _tag: "Success",
      success: cartState,
    });
    const render = mount(addToCart);
    render(product("first-product"));
    act(() => {
      button("Large").click();
    });
    act(() => {
      button("Increase quantity").click();
    });
    window.history.replaceState(null, "", "/products/second-product");
    render(product("second-product"));

    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe("1");
    expect(
      document.querySelector<HTMLInputElement>('[aria-label="Quantity"]')?.value
    ).toBe("1");
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({
      quantity: 1,
      variantId: "1",
    });
    expect(document.querySelector("output")?.dataset.cartOpen).toBe("true");
  });

  it("retains a cart currency outside the bundled locale defaults", async () => {
    const state = Schema.decodeSync(CartPublicState)({
      cart: {
        checkoutDetails: {},
        id: "cart-cad",
        lineItems: [],
        status: "active",
        storeKey: "canada",
        totalLineItemQuantity: 0,
        totalPrice: { centAmount: 0, currencyCode: "CAD" },
      },
      violations: [],
    });
    const addToCart = vi
      .fn<AddToCartAction>()
      .mockResolvedValue({ _tag: "Success", success: state });
    mount(addToCart)(product("canadian-product"));
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(document.querySelector("output")?.dataset.cartCurrency).toBe("CAD");
  });

  it("keeps the cart closed when adding the selected variant fails", async () => {
    const addToCart = vi.fn<AddToCartAction>().mockResolvedValue({
      _tag: "Failure",
      failure: {
        _tag: "CartProviderFailure",
        operation: "addItem",
        reason: "unavailable",
      },
    });
    mount(addToCart)(product("product"));
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledOnce();
    expect(document.querySelector("output")?.dataset.cartOpen).toBe("false");
  });

  it("uses the catalog default if a refresh removes the selected Shopify variant", async () => {
    const addToCart = vi.fn<AddToCartAction>().mockResolvedValue({
      _tag: "Success",
      success: cartState,
    });
    const render = mount(addToCart);
    const original = product("gid://shopify/Product/1");
    const first = variant("gid://shopify/ProductVariant/1", "Small", 10);
    const second = variant("gid://shopify/ProductVariant/2", "Large", 20);
    const replacement = variant(
      "gid://shopify/ProductVariant/3",
      "Replacement",
      30
    );
    render({
      ...original,
      defaultVariantId: first.value,
      variants: [first, second],
    });
    act(() => {
      button("Large").click();
    });
    render({
      ...original,
      defaultVariantId: replacement.value,
      variants: [first, replacement],
    });

    expect(
      document.querySelector('[role="radio"][data-state="checked"]')?.id
    ).toBe(replacement.id);
    await act(async () => {
      button("Add to Cart").click();
      await Promise.resolve();
    });
    expect(addToCart).toHaveBeenCalledWith({
      quantity: 1,
      variantId: replacement.value,
    });
  });
});
