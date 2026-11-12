import type { ChangeCartDiscountCodeAction } from "@repo/commerce-core/cart/change-cart-discount-code";
import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { Schema } from "effect";
import { act, Suspense } from "react";
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

import type { AddToCartAction } from "./add-to-cart";
import { CartButtonClient } from "./cart-button";
import { CartProvider, useCartActions } from "./cart-context";
import { CartPageContent } from "./cart-flyout";
import type { CartFlyoutLinks } from "./cart-flyout";
import type { ChangeCartItemsQuantityAction } from "./change-cart-items-quantity";
import { CartPublicState } from "./public-state";
import type { CartPublicStateEncoded } from "./public-state";
import type { RemoveCartItemAction } from "./remove-cart-item";

const roots: ReturnType<typeof createRoot>[] = [];
const cartState = (quantity: number): CartPublicState =>
  Schema.decodeUnknownSync(CartPublicState)({
    cart: {
      checkoutDetails: {},
      id: "cart-1",
      lineItems:
        quantity === 0
          ? []
          : [
              {
                id: "line-1",
                quantity,
                unitPrice: { centAmount: 1500, currencyCode: "USD" },
                variant: {
                  id: "variant-1",
                  images: [],
                  name: "Test product",
                  productId: "product-1",
                },
              },
            ],
      status: "active",
      storeKey: "store-1",
      totalLineItemQuantity: quantity,
      totalPrice: { centAmount: 1500 * quantity, currencyCode: "USD" },
    },
    violations: [],
  });

const makeActions = () => ({
  addToCart: vi.fn<AddToCartAction>(
    async () =>
      await Promise.resolve({ _tag: "Success", success: cartState(2) })
  ),
  changeCartDiscountCode: vi.fn<ChangeCartDiscountCodeAction>(
    async () =>
      await Promise.resolve({
        _tag: "Success" as const,
        success: cartState(2),
      })
  ),
  changeCartItemsQuantity: vi.fn<ChangeCartItemsQuantityAction>(
    async () =>
      await Promise.resolve({ _tag: "Success", success: cartState(1) })
  ),
  removeCartItem: vi.fn<RemoveCartItemAction>(
    async () =>
      await Promise.resolve({ _tag: "Success", success: cartState(0) })
  ),
});

function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (element === null) {
    throw new Error(`Expected cart button ${selector}`);
  }
  return element;
}

async function mountCart(
  actions: ReturnType<typeof makeActions>,
  initial: CartPublicStateEncoded = cartState(2),
  pageLinks?: CartFlyoutLinks
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = async (state: CartPublicStateEncoded | null) => {
    const promise = Promise.resolve(state);
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale="en-US"
          messages={messages}
          timeZone="UTC"
          formats={{
            number: {
              wholeMoneyWithCurrency: {
                maximumFractionDigits: 0,
                minimumFractionDigits: 0,
                style: "currency",
              },
            },
          }}
        >
          <CartProvider actions={actions} cartPromise={promise}>
            <Suspense fallback={<span>Loading cart</span>}>
              {pageLinks === undefined ? (
                <CartButtonClient />
              ) : (
                <CartPageContent {...pageLinks} />
              )}
            </Suspense>
          </CartProvider>
        </NextIntlClientProvider>
      );
      await promise;
    });
  };
  await render(initial);
  if (pageLinks === undefined) {
    act(() => {
      button('[aria-label="Open cart"]').click();
    });
  }
  return render;
}

const twoLineCart = (): CartPublicState => {
  const initial = cartState(1);
  return Schema.decodeSync(CartPublicState)({
    ...initial,
    cart: {
      ...initial.cart,
      lineItems: initial.cart.lineItems.flatMap((line) => [
        line,
        {
          ...line,
          id: "line-2",
          variant: { ...line.variant, id: "variant-2", name: "Second product" },
        },
      ]),
      totalLineItemQuantity: 2,
      totalPrice: { centAmount: 3000, currencyCode: "USD" },
    },
  });
};

const deferredCart = () => {
  let complete: (cart: CartPublicStateEncoded | null) => void;
  // oxlint-disable-next-line promise/avoid-new -- Control the native promise consumed by React.use() to exercise server-response races.
  const promise = new Promise<CartPublicStateEncoded | null>((resolve) => {
    complete = resolve;
  });
  return {
    promise,
    resolve: (cart: CartPublicStateEncoded | null) => {
      complete(cart);
    },
  };
};

function AddSecondCartLine() {
  const { addItem } = useCartActions();
  return (
    <button
      data-add-cart-line=""
      type="button"
      onClick={() => {
        void addItem({ quantity: 1, variantId: "variant-2" });
      }}
    >
      Add second line
    </button>
  );
}

async function mountCartNavigation(
  actions: ReturnType<typeof makeActions>,
  initialPromise: Promise<CartPublicStateEncoded | null>
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = async (
    promise: Promise<CartPublicStateEncoded | null>,
    showPage: boolean
  ) => {
    await act(async () => {
      root.render(
        <NextIntlClientProvider
          locale="en-US"
          messages={messages}
          timeZone="UTC"
        >
          <CartProvider actions={actions} cartPromise={promise}>
            <Suspense fallback={null}>
              <CartButtonClient />
            </Suspense>
            <AddSecondCartLine />
            {showPage ? (
              <main>
                <Suspense fallback={null}>
                  <CartPageContent />
                </Suspense>
              </main>
            ) : null}
          </CartProvider>
        </NextIntlClientProvider>
      );
      await Promise.resolve();
    });
  };
  await render(initialPromise, false);
  return render;
}

describe("Connected cart presentation", () => {
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
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each([{ productsHref: null }, { productsHref: "/products" as const }])(
    "uses the installed catalog destination on the Cart page: $productsHref",
    async (links) => {
      await mountCart(makeActions(), cartState(0), links);
      const browse = document.querySelector<HTMLAnchorElement>("a");
      expect(browse?.getAttribute("href") ?? null).toBe(links.productsHref);
    }
  );

  it("renders commerce state through design-system props and updates after a successful removal", async () => {
    const actions = makeActions();
    await mountCart(actions);
    expect(
      document.querySelector<HTMLElement>(
        '[data-commerce-money="cart-subtotal"]'
      )?.dataset.minorAmount
    ).toBe("3000");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Test product"
    );
    await act(async () => {
      button("[data-cart-line-item] button").click();
      await Promise.resolve();
    });
    expect(actions.removeCartItem).toHaveBeenCalledWith({
      lineItemId: "line-1",
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Your cart is empty"
    );
  });

  it("keeps the current cart when a removal returns a domain failure", async () => {
    const actions = makeActions();
    actions.removeCartItem.mockResolvedValue({
      _tag: "Failure",
      failure: {
        _tag: "CartProviderFailure",
        operation: "removeLineItem",
        reason: "unavailable",
      },
    });
    await mountCart(actions);
    await act(async () => {
      button("[data-cart-line-item] button").click();
      await Promise.resolve();
    });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Test product"
    );
    expect(button('[aria-label="Open cart"]').textContent).toBe("2");
  });

  it("keeps both cart lines in the page and flyout when View cart opens after adding a product", async () => {
    const actions = makeActions();
    actions.addToCart.mockResolvedValue({
      _tag: "Success",
      success: twoLineCart(),
    });
    const promise = Promise.resolve(cartState(1));
    const render = await mountCartNavigation(actions, promise);
    await act(async () => {
      button("[data-add-cart-line]").click();
      await Promise.resolve();
    });
    expect(
      document
        .querySelector('[role="dialog"]')
        ?.querySelectorAll("[data-cart-line-item]")
    ).toHaveLength(2);
    await render(promise, true);
    expect(
      document.querySelector("main")?.querySelectorAll("[data-cart-line-item]")
    ).toHaveLength(2);
    expect(
      document
        .querySelector('[role="dialog"]')
        ?.querySelectorAll("[data-cart-line-item]")
    ).toHaveLength(2);
  });

  it("preserves a completed cart action when the initial server snapshot resolves later", async () => {
    const actions = makeActions();
    actions.addToCart.mockResolvedValue({
      _tag: "Success",
      success: twoLineCart(),
    });
    const initial = deferredCart();
    const render = await mountCartNavigation(actions, initial.promise);
    await act(async () => {
      button("[data-add-cart-line]").click();
      await Promise.resolve();
    });
    await act(async () => {
      initial.resolve(cartState(1));
      await initial.promise;
    });
    await render(initial.promise, true);
    expect(
      document.querySelector("main")?.querySelectorAll("[data-cart-line-item]")
    ).toHaveLength(2);
    expect(button('[aria-label="Open cart"]').textContent).toBe("2");
  });

  it("ignores a superseded server snapshot that resolves after the current snapshot", async () => {
    const initial = deferredCart();
    const render = await mountCartNavigation(makeActions(), initial.promise);
    await render(Promise.resolve(twoLineCart()), true);
    await act(async () => {
      initial.resolve(cartState(1));
      await initial.promise;
    });
    expect(
      document.querySelector("main")?.querySelectorAll("[data-cart-line-item]")
    ).toHaveLength(2);
    expect(button('[aria-label="Open cart"]').textContent).toBe("2");
  });

  it("replaces client cart state when the server supplies a fresh cart promise", async () => {
    const render = await mountCart(makeActions());
    await render(cartState(0));
    expect(document.querySelector("[data-cart-line-item]")).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Your cart is empty"
    );
    expect(button('[aria-label="Open cart"]').textContent).toBe("");
  });

  it("clears client cart state when the server reports no current cart", async () => {
    const render = await mountCart(makeActions());
    await render(null);
    expect(document.querySelector("[data-cart-line-item]")).toBeNull();
    expect(button('[aria-label="Open cart"]').textContent).toBe("");
  });

  it("renders native totals and promotion status and removes a code without changing the buyer context", async () => {
    const actions = makeActions();
    const initial = cartState(2);
    await mountCart(actions, {
      ...initial,
      cart: {
        ...initial.cart,
        discountCodes: [{ applicable: false, code: "SAVE" }],
        discounts: [
          {
            amount: { centAmount: 500, currencyCode: "USD" },
            label: "Automatic offer",
            target: "items",
          },
        ],
        lineItems: initial.cart.lineItems.map((line) => ({
          ...line,
          regularUnitPrice: { centAmount: 2000, currencyCode: "USD" },
          totalPrice: { centAmount: 2500, currencyCode: "USD" },
        })),
        subtotalPrice: { centAmount: 3000, currencyCode: "USD" },
        totalPrice: { centAmount: 2500, currencyCode: "USD" },
      },
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect({
      inapplicable: dialog?.textContent?.includes("This code does not apply"),
      offer: dialog?.textContent?.includes("Automatic offer"),
      original: dialog?.querySelector("del")?.textContent,
      subtotal: dialog?.querySelector('[data-commerce-money="cart-subtotal"]')
        ?.textContent,
      total: dialog?.textContent?.includes("$25.00"),
    }).toEqual({
      inapplicable: true,
      offer: true,
      original: "$40.00",
      subtotal: "$30.00",
      total: true,
    });
    await act(async () => {
      button('[aria-label="Remove SAVE"]').click();
      await Promise.resolve();
    });
    expect(actions.changeCartDiscountCode).toHaveBeenCalledWith({
      action: "remove",
      code: "SAVE",
    });
  });

  it("shows included tax and the provider's total without adding tax again", async () => {
    const initial = cartState(1);
    await mountCart(makeActions(), {
      ...initial,
      cart: {
        ...initial.cart,
        tax: {
          status: "known",
          includedInPrice: "yes",
          amount: { centAmount: 250, currencyCode: "USD" },
        },
        totalPriceEstimated: false,
      },
    });
    const tax = document.querySelector('[data-commerce-tax-status="known"]');
    expect(tax?.textContent).toContain("Tax (included)");
    expect(tax?.textContent).toContain("$2.50");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "$15.00"
    );
  });

  it("shows unknown tax and an estimated total for a hosted checkout cart", async () => {
    await mountCart(makeActions());
    expect(
      document.querySelector('[data-commerce-tax-status="unknown"]')
        ?.textContent
    ).toContain("Calculated at checkout");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Estimated total"
    );
  });
});
