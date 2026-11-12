"use client";

import type {
  AddToCartAction,
  AddToCartInput,
} from "@repo/commerce-core/cart/add-to-cart";
import type { ChangeCartItemsQuantityAction } from "@repo/commerce-core/cart/change-cart-items-quantity";
import type { CartPublicStateEncoded } from "@repo/commerce-core/cart/public-state";
import type { RemoveCartItemAction } from "@repo/commerce-core/cart/remove-cart-item";
import type { CartLineItemEncoded } from "@repo/commerce-core/domain/cart-snapshot";
import { moneyToUnits } from "@repo/commerce-core/domain/money";
import type { CurrencyCode } from "@repo/commerce-core/domain/money";
import { useTranslations } from "@repo/i18n";
import {
  createContext,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type {
  ChangeCartDiscountCodeAction,
  ChangeCartDiscountCodeInput,
} from "./change-cart-discount-code";

type CartActions = {
  addToCart: AddToCartAction;
  changeCartDiscountCode: ChangeCartDiscountCodeAction;
  changeCartItemsQuantity: ChangeCartItemsQuantityAction;
  removeCartItem: RemoveCartItemAction;
};

type CartContextType = {
  cartPromise: Promise<CartPublicStateEncoded | null>;
  cart: CartPublicStateEncoded | null | undefined;
  setCart: (cart: CartPublicStateEncoded | null) => void;
  isOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  actions: CartActions;
};

const CartContext = createContext<CartContextType | null>(null);

type CartProviderProps = {
  children: ReactNode;
  cartPromise: Promise<CartPublicStateEncoded | null>;
  actions: CartActions;
};

/**
 * Applies each server snapshot once for all cart readers. Leaf components
 * resolve the promise within their own Suspense boundaries, so the provider
 * does not block the rest of the application while the cart loads.
 */
export function CartProvider({
  children,
  cartPromise,
  actions,
}: CartProviderProps) {
  const [cart, setCart] = useState<CartPublicStateEncoded | null>();
  const mutationSource = useRef<typeof cartPromise | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const updateCart = useCallback(
    (next: CartPublicStateEncoded | null) => {
      // An action result supersedes the initial read for this server promise.
      mutationSource.current = cartPromise;
      setCart(next);
    },
    [cartPromise]
  );

  useEffect(() => {
    let active = true;
    void cartPromise.then(
      (snapshot) => {
        if (active && mutationSource.current !== cartPromise) {
          setCart(snapshot);
        }
      },
      () => {
        // Readers surface rejected snapshots through React.use().
      }
    );
    return () => {
      active = false;
    };
  }, [cartPromise]);

  const openCart = useCallback(() => {
    setIsOpen(true);
  }, []);
  const closeCart = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      actions,
      cart,
      cartPromise,
      closeCart,
      isOpen,
      openCart,
      setCart: updateCart,
    }),
    [cartPromise, cart, isOpen, openCart, closeCart, actions, updateCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/**
 * useCartData - reads the shared cart, resolving initial data through Suspense.
 * IMPORTANT: Components using this hook MUST be wrapped in Suspense!
 * This hook causes suspension until the cart promise resolves.
 */
export function useCartData() {
  const ctx = useContext(CartContext);

  if (!ctx) {
    throw new Error("useCartData must be used within CartProvider");
  }

  const { cartPromise, cart } = ctx;

  // Resolve promise - this causes suspension!
  const resolvedCart = use(cartPromise);

  return cart === undefined ? resolvedCart : cart;
}

/**
 * useCartState - access cart UI state (open/close) without resolving promise.
 * Safe to use anywhere - does NOT cause suspension.
 */
export function useCartState() {
  const ctx = useContext(CartContext);

  if (!ctx) {
    throw new Error("useCartState must be used within CartProvider");
  }

  return {
    closeCart: ctx.closeCart,
    isOpen: ctx.isOpen,
    openCart: ctx.openCart,
  };
}

/**
 * useCart - access cart data and mutation functions.
 * Uses the provider's shared state after loading or a successful action.
 * Does NOT cause suspension - cart should already be in state.
 */
export function useCart(initialCart?: CartPublicStateEncoded | null) {
  const ctx = useContext(CartContext);
  const t = useTranslations("web.cart");

  if (!ctx) {
    throw new Error("useCart must be used within CartProvider");
  }

  const {
    cart: currentCart,
    setCart,
    isOpen,
    openCart,
    closeCart,
    actions,
  } = ctx;
  const state = currentCart === undefined ? initialCart : currentCart;
  const cart = state?.cart ?? null;
  const cartCurrency = cart?.totalPrice.currencyCode;
  const currencyCode: CurrencyCode = cartCurrency ?? "USD";
  const violations = state?.violations ?? [];

  const items = useMemo(() => {
    const lineItems = cart?.lineItems ?? [];
    return lineItems.map((lineItem: CartLineItemEncoded) => {
      const { id, quantity, unitPrice, variant } = lineItem;
      const image = variant.images[0]?.url ?? "";

      return {
        discounts: lineItem.discounts ?? [],
        id,
        image,
        name: variant.name ?? "",
        originalTotalPrice: moneyToUnits({
          ...unitPrice,
          centAmount: Math.max(
            (lineItem.regularUnitPrice ?? unitPrice).centAmount * quantity,
            lineItem.subtotalPrice?.centAmount ?? 0
          ),
        }),
        price: moneyToUnits(unitPrice),
        quantity,
        summaryAttribute: variant.summaryAttribute,
        totalPrice: moneyToUnits(
          lineItem.totalPrice ?? {
            ...unitPrice,
            centAmount: unitPrice.centAmount * quantity,
          }
        ),
      };
    });
  }, [cart]);

  const totalItems = useMemo(() => {
    let sum = 0;
    for (const i of items) {
      sum += i.quantity;
    }
    return sum;
  }, [items]);

  const totalPrice = cart ? moneyToUnits(cart.totalPrice) : 0;
  const subtotalPrice = cart?.subtotalPrice
    ? moneyToUnits(cart.subtotalPrice)
    : items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const changeDiscountCode = useCallback(
    async (input: ChangeCartDiscountCodeInput) => {
      const result = await actions.changeCartDiscountCode(input);
      if (result._tag === "Failure") {
        return false;
      }
      setCart(result.success);
      return true;
    },
    [actions, setCart]
  );

  const addItem = useCallback(
    async (input: AddToCartInput) => {
      const result = await actions.addToCart(input);
      if (result._tag === "Failure") {
        toast.error(t("toast.failedToAdd"));
        return;
      }
      setCart(result.success);
      openCart();
      toast.success(t("toast.addedToCart"));
    },
    [actions, setCart, openCart, t]
  );

  const removeItem = useCallback(
    async (id: string) => {
      const result = await actions.removeCartItem({ lineItemId: id });
      if (result._tag === "Failure") {
        toast.error(t("toast.failedToRemove"));
        return;
      }
      setCart(result.success);
      toast.success(t("toast.removedFromCart"));
    },
    [actions, setCart, t]
  );

  const updateQuantity = useCallback(
    async (id: string, quantity: number) => {
      const result = await actions.changeCartItemsQuantity({
        lineItemId: id,
        quantity,
      });
      if (result._tag === "Failure") {
        toast.error(t("toast.failedToUpdate"));
        return;
      }
      setCart(result.success);
      toast.success(t("toast.updatedQuantity"));
    },
    [actions, setCart, t]
  );

  return {
    addItem,
    changeDiscountCode,
    closeCart,
    currencyCode,
    discountCodes: cart?.discountCodes ?? [],
    discounts: cart?.discounts ?? [],
    isOpen,
    items,
    openCart,
    removeItem,
    subtotalPrice,
    tax: cart?.tax,
    totalItems,
    totalPrice,
    totalPriceEstimated: cart?.totalPriceEstimated !== false,
    updateQuantity,
    violations,
  };
}

/**
 * useCartActions - access cart actions without needing cart data.
 * Safe to use anywhere - for components that only need to add items.
 * Does NOT cause suspension.
 */
export function useCartActions() {
  const ctx = useContext(CartContext);
  const t = useTranslations("web.cart");

  if (!ctx) {
    throw new Error("useCartActions must be used within CartProvider");
  }

  const { setCart, isOpen, openCart, closeCart, actions } = ctx;

  const addItem = useCallback(
    async (input: AddToCartInput) => {
      const result = await actions.addToCart(input);
      if (result._tag === "Failure") {
        toast.error(t("toast.failedToAdd"));
        return;
      }
      setCart(result.success);
      openCart();
      toast.success(t("toast.addedToCart"));
    },
    [actions, setCart, openCart, t]
  );

  return { addItem, closeCart, isOpen, openCart };
}
