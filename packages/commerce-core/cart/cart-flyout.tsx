"use client";

import {
  CartContents,
  CartFlyout as CartFlyoutView,
} from "@repo/design-system/components/commerce/blocks/cart-flyout";
import { Button } from "@repo/design-system/components/ui/button";
import { useFormatter, useTranslations } from "@repo/i18n";
import type { Route } from "next";
import Link from "next/link";

import { moneyToUnits } from "../domain/money";
import { useCart, useCartData } from "./cart-context";
import { DiscountCodes } from "./discount-codes";
import type { CartPublicStateEncoded } from "./public-state";

// SAFETY: The generated Route union requires the locale-prefixed form of this destination.
const CHECKOUT_ROUTE = "/checkout" as Route;
// SAFETY: The cart route is installed by the Commerce web recipe.
const CART_ROUTE = "/cart" as Route;

export interface CartFlyoutLinks {
  readonly checkoutHref?: Route | null;
  readonly productsHref?: Route | null;
}

function CartView({
  checkoutHref = CHECKOUT_ROUTE,
  productsHref = null,
  flyout,
  initialCart,
}: CartFlyoutLinks & {
  readonly flyout: boolean;
  readonly initialCart?: CartPublicStateEncoded | null;
}) {
  const {
    items,
    totalItems,
    totalPrice,
    subtotalPrice,
    tax,
    totalPriceEstimated,
    discounts,
    removeItem,
    updateQuantity,
    isOpen,
    closeCart,
    currencyCode,
    discountCodes,
    changeDiscountCode,
  } = useCart(initialCart);
  const format = useFormatter();
  const t = useTranslations("web.cart");
  const formatPrice = (price: number) =>
    format.number(price, { currency: currencyCode, style: "currency" });
  const View = flyout ? CartFlyoutView : CartContents;

  return (
    <View
      tax={
        <div
          className="flex justify-between text-sm"
          data-commerce-tax-status={tax?.status ?? "unknown"}
        >
          <span className="text-muted-foreground">
            {tax?.status !== "unknown" && tax?.includedInPrice === "yes"
              ? t("summary.tax.included")
              : t("summary.tax.label")}
          </span>
          <span>
            {tax === undefined || tax.status === "unknown"
              ? t("summary.tax.unknown")
              : `${tax.status === "estimated" ? `${t("summary.tax.estimated")} ` : ""}${formatPrice(moneyToUnits(tax.amount))}`}
          </span>
        </div>
      }
      totalLabel={
        totalPriceEstimated
          ? t("summary.total.estimated")
          : t("summary.total.label")
      }
      promotions={
        <DiscountCodes
          discountCodes={discountCodes}
          changeDiscountCode={changeDiscountCode}
        />
      }
      discounts={discounts.map((discount, index) => (
        <div
          key={`${discount.reference ?? discount.label ?? "discount"}/${discount.target}/${index}`}
          className="flex justify-between text-sm text-green-700 dark:text-green-400"
        >
          <span>{discount.label ?? t("promotions.discount")}</span>
          <span>−{formatPrice(moneyToUnits(discount.amount))}</span>
        </div>
      ))}
      items={items.map((item) => ({
        id: item.id,
        image: item.image,
        name: item.name,
        quantity: item.quantity,
        summary:
          item.summaryAttribute === undefined
            ? undefined
            : `${item.summaryAttribute.label}: ${item.summaryAttribute.value}`,
        totalPrice: (
          <span className="flex flex-col items-end">
            {item.originalTotalPrice > item.totalPrice && (
              <del className="text-xs font-normal text-muted-foreground">
                {formatPrice(item.originalTotalPrice)}
              </del>
            )}
            <span>{formatPrice(item.totalPrice)}</span>
          </span>
        ),
      }))}
      totalItems={totalItems}
      subtotal={
        <span
          data-commerce-money="cart-subtotal"
          data-currency={currencyCode}
          data-minor-amount={Math.round(
            subtotalPrice *
              10 **
                (new Intl.NumberFormat("en", {
                  currency: currencyCode,
                  style: "currency",
                }).resolvedOptions().maximumFractionDigits ?? 2)
          )}
        >
          {formatPrice(subtotalPrice)}
        </span>
      }
      total={formatPrice(totalPrice)}
      isOpen={isOpen}
      onOpenChange={closeCart}
      onRemove={(id) => {
        void removeItem(id);
      }}
      onQuantityChange={(id, quantity) => {
        void updateQuantity(id, quantity);
      }}
      emptyAction={
        productsHref && (
          <Button onClick={closeCart} asChild>
            <Link href={productsHref}>{t("empty.actions.browseProducts")}</Link>
          </Button>
        )
      }
      actions={
        <>
          {checkoutHref && (
            <Button className="h-12 w-full" size="lg" asChild>
              <Link href={checkoutHref} onClick={closeCart}>
                {t("actions.checkout")}
              </Link>
            </Button>
          )}
          {flyout && (
            <Button variant="outline" className="w-full" asChild>
              <Link href={CART_ROUTE} onClick={closeCart}>
                {t("actions.viewCart")}
              </Link>
            </Button>
          )}
          {flyout && (
            <Button
              variant="outline"
              className="w-full bg-transparent"
              onClick={closeCart}
            >
              {t("actions.continueShopping")}
            </Button>
          )}
        </>
      }
    />
  );
}

export function CartFlyout(links: CartFlyoutLinks = {}) {
  return <CartView {...links} flyout />;
}

export function CartPageContent(links: CartFlyoutLinks = {}) {
  const cart = useCartData();
  return <CartView {...links} flyout={false} initialCart={cart} />;
}
