"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { ShoppingCart } from "lucide-react";
import type { ReactNode } from "react";

export interface CartButtonProps {
  readonly totalItems: number;
  readonly onOpen: () => void;
  readonly flyout?: ReactNode;
}

export function CartButtonClient({
  totalItems,
  onOpen,
  flyout,
}: CartButtonProps) {
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open cart"
        className="relative"
        data-cart-trigger=""
        onClick={onOpen}
      >
        <ShoppingCart className="h-5 w-5" />
        {totalItems > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground text-xs">
            {totalItems}
          </span>
        )}
      </Button>
      {flyout}
    </div>
  );
}
