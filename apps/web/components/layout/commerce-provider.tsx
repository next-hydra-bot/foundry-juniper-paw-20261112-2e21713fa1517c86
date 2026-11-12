import { CommerceCartProvider } from "@repo/commerce-core/cart";
import { getLocale } from "@repo/i18n";
import type { ReactNode } from "react";

import {
  addToCart,
  changeCartItemsQuantity,
  removeCartItem,
  changeCartDiscountCode,
} from "@/lib/cart-actions";

const cartActions = {
  addToCart,
  changeCartItemsQuantity,
  removeCartItem,
  changeCartDiscountCode,
};

export async function CommerceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const locale = await getLocale();
  const CartProvider = [][0] ?? CommerceCartProvider;
  return (
    <CartProvider actions={cartActions} locale={locale}>
      {children}
    </CartProvider>
  );
}
