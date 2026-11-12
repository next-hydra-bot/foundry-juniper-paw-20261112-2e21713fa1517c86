import "server-only";
import type { AddToCartAction } from "@repo/commerce-core/cart/add-to-cart";
import type { ChangeCartItemsQuantityAction } from "@repo/commerce-core/cart/change-cart-items-quantity";
import { toCartPublicState } from "@repo/commerce-core/cart/public-state";
import type { RemoveCartItemAction } from "@repo/commerce-core/cart/remove-cart-item";
import { HeaderCommerceRuntime } from "@repo/commerce-core/runtime/header-runtime";
import type { Locale } from "@repo/i18n/types";
import { Effect, Option } from "effect";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";

import { CurrentCart } from "../services/current-cart";
import { CartProvider } from "./cart-context";
import type { ChangeCartDiscountCodeAction } from "./change-cart-discount-code";
import type { CartPublicState } from "./public-state";

const loadCurrentCart = async (locale: Locale) => {
  await connection();

  try {
    const cart = await HeaderCommerceRuntime.run(
      locale,
      CurrentCart.get().pipe(
        Effect.tapError((error) =>
          Effect.logError("Failed to read Current Cart", error).pipe(
            Effect.annotateLogs({ operation: "currentCart.get" })
          )
        )
      )
    );
    return Option.match(cart, {
      onNone: () => null,
      onSome: toCartPublicState,
    });
  } catch (error) {
    unstable_rethrow(error);
    await Effect.runPromise(
      Effect.logError("Failed to read Current Cart", error).pipe(
        Effect.annotateLogs({ operation: "currentCart.get" })
      )
    );
    return null;
  }
};

interface CommerceCartProviderProps {
  readonly actions: {
    readonly addToCart: AddToCartAction;
    readonly changeCartItemsQuantity: ChangeCartItemsQuantityAction;
    readonly removeCartItem: RemoveCartItemAction;
    readonly changeCartDiscountCode: ChangeCartDiscountCodeAction;
  };
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly cartPromise?: Promise<CartPublicState | null>;
}

export function CommerceCartProvider({
  actions,
  children,
  locale,
  cartPromise,
}: CommerceCartProviderProps) {
  return (
    <CartProvider
      actions={actions}
      cartPromise={cartPromise ?? loadCurrentCart(locale)}
    >
      {children}
    </CartProvider>
  );
}
