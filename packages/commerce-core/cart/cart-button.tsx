"use client";

import { CartButtonClient as CartButtonView } from "@repo/design-system/components/layout/cart-button";

import { useCartData, useCartState } from "./cart-context";
import { CartFlyout } from "./cart-flyout";
import type { CartFlyoutLinks } from "./cart-flyout";

export function CartButtonClient(links: CartFlyoutLinks) {
  const cart = useCartData();
  const { isOpen, openCart } = useCartState();
  const totalItems =
    cart?.cart.lineItems.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <CartButtonView
      totalItems={totalItems}
      onOpen={openCart}
      flyout={isOpen ? <CartFlyout {...links} /> : null}
    />
  );
}
