"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@repo/design-system/components/ui/sheet";
import { useTranslations } from "@repo/i18n";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

export interface CartFlyoutItem {
  readonly id: string;
  readonly name: string;
  readonly image: string;
  readonly quantity: number;
  readonly totalPrice: ReactNode;
  readonly summary?: ReactNode;
}

export interface CartContentsProps {
  readonly items: readonly CartFlyoutItem[];
  readonly subtotal: ReactNode;
  readonly total: ReactNode;
  readonly onRemove: (id: string) => void;
  readonly onQuantityChange: (id: string, quantity: number) => void;
  readonly actions?: ReactNode;
  readonly emptyAction?: ReactNode;
  readonly promotions?: ReactNode;
  readonly discounts?: ReactNode;
  readonly tax?: ReactNode;
  readonly totalLabel?: ReactNode;
}

export interface CartFlyoutProps extends CartContentsProps {
  readonly totalItems: number;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function CartContents({
  items,
  subtotal,
  total,
  onRemove,
  onQuantityChange,
  actions,
  emptyAction,
  promotions,
  discounts,
  tax,
  totalLabel,
}: CartContentsProps) {
  const t = useTranslations("web.cart");
  return items.length === 0 ? (
    <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
      <ShoppingBag className="mb-4 h-16 w-16 text-muted-foreground" />
      <h3 className="mb-2 font-semibold text-lg">{t("empty.heading")}</h3>
      <p className="mb-6 text-muted-foreground">{t("empty.description")}</p>
      {emptyAction}
    </div>
  ) : (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {items.map((item) => (
          <div
            data-cart-line-item=""
            key={item.id}
            className="flex gap-4 rounded-lg border bg-card p-4"
          >
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md bg-muted">
              <Image
                src={item.image || "/placeholder.svg"}
                alt={item.name}
                fill
                className="object-cover"
              />
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold leading-tight">{item.name}</h4>
                  {item.summary === undefined ||
                  item.summary === null ? null : (
                    <p className="text-muted-foreground text-sm">
                      {item.summary}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => {
                    onRemove(item.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 bg-transparent"
                    onClick={() => {
                      onQuantityChange(item.id, item.quantity - 1);
                    }}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center font-medium">
                    {item.quantity}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 bg-transparent"
                    onClick={() => {
                      onQuantityChange(item.id, item.quantity + 1);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <p className="font-bold">{item.totalPrice}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-4 border-t pt-6">
        {promotions}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("summary.subtotal.label")}
            </span>
            <span className="font-medium">{subtotal}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {t("summary.shipping.label")}
            </span>
            <span className="font-medium">
              {t("summary.shipping.description")}
            </span>
          </div>
          {discounts}
          {tax}
          <div className="flex justify-between border-t pt-2 font-bold text-lg">
            <span>{totalLabel ?? t("summary.total.label")}</span>
            <span>{total}</span>
          </div>
        </div>

        <div className="space-y-2">{actions}</div>

        <p className="text-center text-muted-foreground text-xs">
          {t("summary.taxesAndShippingNotice")}
        </p>
      </div>
    </>
  );
}

export function CartFlyout({
  isOpen,
  onOpenChange,
  ...props
}: CartFlyoutProps) {
  const t = useTranslations("web.cart");
  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 p-6 sm:max-w-lg overflow-y-auto">
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            {t("title", { count: props.totalItems })}
          </SheetTitle>
        </SheetHeader>
        <CartContents {...props} />
      </SheetContent>
    </Sheet>
  );
}
