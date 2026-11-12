"use client";

import ImageViewer from "@repo/design-system/components/commerce/image-viewer-basic";
import PriceFormatSale from "@repo/design-system/components/commerce/price-format-sale";
import QuantityInputBasic from "@repo/design-system/components/commerce/quantity-input-basic";
import VariantSelectorBasic from "@repo/design-system/components/commerce/variant-selector-basic";
import type { VariantItem as BaseVariantItem } from "@repo/design-system/components/commerce/variant-selector-basic";
import { Button } from "@repo/design-system/components/ui/button";
import { useFormatter, useTranslations } from "@repo/i18n";
import { Clock } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

interface VariantItem extends BaseVariantItem {
  id: string;
  price?: number;
  salePrice?: number | undefined;
  imageUrl?: string;
  isInStock?: boolean;
  availableQuantity?: number | null;
  currencyCode?: string;
}
type VariantSelectionPayload = {
  variantId: string;
  variantLabel: string;
  quantity: number;
  price?: number;
  originalPrice?: number;
  salePrice?: number | undefined;
  totalPrice?: number;
  isOnSale: boolean;
};
type ProductVariantProps = {
  title?: string;
  media?: ReactNode;
  heading?: ReactNode;
  description?: string;
  badge?: string | null;
  shippingInfo?: string;
  variants: VariantItem[];
  defaultImage?: string;
  initialVariant?: string;
  variantLabel?: string;
  onAddToCart?: (payload: VariantSelectionPayload) => void;
  onQuoteRequest?: () => void;
  selectedVariant?: string;
  onVariantChange?: (variant: string) => void;
  quantity?: number;
  onQuantityChange?: (quantity: number) => void;
  isLoading?: boolean;
  errorMessage?: string | null;
  optionSelector?: ReactNode;
  selectionUnavailable?: boolean;
};

const isVariantInStock = (variant: VariantItem): boolean =>
  variant.isInStock ?? true;

const addStockIndicators = (
  variants: readonly VariantItem[],
  outOfStockSuffix: string
): VariantItem[] =>
  variants.map((variant) => {
    const inStock = isVariantInStock(variant);
    return {
      ...variant,
      disabled: !inStock,
      label: variant.label + (inStock ? "" : ` ${outOfStockSuffix}`),
    };
  });

const makeVariantSelectionPayload = ({
  currentPrice,
  currentSalePrice,
  effectivePrice,
  isOnSale,
  quantity,
  selectedVariant,
}: {
  readonly currentPrice: number | undefined;
  readonly currentSalePrice: number | undefined;
  readonly effectivePrice: number | undefined;
  readonly isOnSale: boolean;
  readonly quantity: number;
  readonly selectedVariant: VariantItem;
}): VariantSelectionPayload => {
  const selection: VariantSelectionPayload = {
    isOnSale,
    quantity,
    variantId: selectedVariant.value,
    variantLabel: selectedVariant.label,
  };
  if (currentPrice === undefined) {
    return selection;
  }
  return {
    ...selection,
    originalPrice: isOnSale ? currentPrice : undefined,
    price: currentPrice,
    salePrice: isOnSale ? currentSalePrice : undefined,
    totalPrice: quantity * (effectivePrice ?? currentPrice),
  };
};

const variantDisplay = (
  variant: VariantItem,
  defaultImage: string | undefined,
  unavailable: boolean
) => {
  const currentPrice = unavailable ? undefined : variant.price;
  const currentSalePrice = unavailable ? undefined : variant.salePrice;
  const isOnSale =
    currentPrice !== undefined &&
    currentSalePrice !== undefined &&
    currentSalePrice < currentPrice;
  return {
    currencyCode: variant.currencyCode,
    currentImage: unavailable
      ? defaultImage
      : (variant.imageUrl ?? defaultImage),
    currentPrice,
    currentSalePrice,
    effectivePrice: isOnSale ? currentSalePrice : currentPrice,
    inStock: !unavailable && isVariantInStock(variant),
    isOnSale,
  };
};

const slotOrDefault = (
  slot: ReactNode | undefined,
  fallback: ReactNode
): ReactNode => (slot === undefined ? fallback : slot);

function ProductVariant({
  badge,
  defaultImage,
  description,
  errorMessage = null,
  initialVariant,
  isLoading = false,
  media,
  heading,
  onAddToCart,
  onQuoteRequest,
  onQuantityChange,
  onVariantChange,
  quantity: controlledQuantity,
  selectedVariant: controlledVariant,
  optionSelector,
  selectionUnavailable = false,
  shippingInfo,
  variantLabel,
  title,
  variants,
}: ProductVariantProps) {
  // Ensure variants array is not empty
  if (variants[0] === undefined) {
    throw new Error("At least one variant must be provided");
  }
  const t = useTranslations("web.product");
  const format = useFormatter();
  const defaultInitialVariant = initialVariant ?? variants[0].value;

  const [internalSelectedVariant, setInternalSelectedVariant] = useState(
    defaultInitialVariant
  );
  const [internalQuantity, setInternalQuantity] = useState(1);

  // Determine if we're in controlled or uncontrolled mode
  const isVariantControlled = controlledVariant !== undefined;
  const isQuantityControlled = controlledQuantity !== undefined;
  const requestedVariantId = isVariantControlled
    ? controlledVariant
    : internalSelectedVariant;
  const quantity = isQuantityControlled ? controlledQuantity : internalQuantity;

  const handleVariantChange = (newVariant: string) => {
    if (isVariantControlled) {
      onVariantChange?.(newVariant);
    } else {
      setInternalSelectedVariant(newVariant);
    }
  };

  const handleQuantityChange = (newQuantity: number) => {
    if (isQuantityControlled) {
      onQuantityChange?.(newQuantity);
    } else {
      setInternalQuantity(newQuantity);
    }
  };

  const selectedVariant =
    variants.find((variant) => variant.value === requestedVariantId) ??
    variants.find((variant) => variant.value === initialVariant) ??
    variants[0];

  const {
    currentImage,
    currentPrice,
    currentSalePrice,
    currencyCode,
    isOnSale,
    inStock,
    effectivePrice,
  } = variantDisplay(selectedVariant, defaultImage, selectionUnavailable);
  const { availableQuantity } = selectedVariant;

  const handleAddToCart = () => {
    if (selectionUnavailable) {
      return;
    }
    onAddToCart?.(
      makeVariantSelectionPayload({
        currentPrice,
        currentSalePrice,
        effectivePrice,
        isOnSale,
        quantity,
        selectedVariant,
      })
    );
  };

  const handleQuoteRequest = () => {
    onQuoteRequest?.();
  };

  if (errorMessage) {
    return (
      <div className="my-6 rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-destructive">
        <p className="font-medium">{t("errorLoadingProduct")}</p>
        <p className="text-sm">{errorMessage}</p>
      </div>
    );
  }

  const variantsWithStockIndicator = addStockIndicators(
    variants,
    t("outOfStockSuffix")
  );

  return (
    <div
      className={
        media === null
          ? "flex flex-col gap-6"
          : "my-6 grid max-w-screen-lg grid-cols-1 gap-12 rounded-lg md:grid-cols-2"
      }
    >
      {slotOrDefault(
        media,
        <div className="relative h-fit w-full overflow-hidden rounded-2xl bg-muted p-5">
          {badge && (
            <span className="absolute top-4 left-4 z-10 rounded-full bg-primary px-3 py-1.5 font-bold text-primary-foreground text-xs">
              {badge}
            </span>
          )}
          <div className="transition-transform duration-500 hover:scale-105">
            {isLoading ? (
              <div className="flex h-[300px] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-primary" />
              </div>
            ) : (
              <ImageViewer
                imageUrl={currentImage ?? ""}
                classNameThumbnailViewer="rounded-lg object-contain h-[300px] mx-auto"
              />
            )}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-6">
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-1/3 animate-pulse rounded-md bg-muted" />
          </div>
        ) : (
          <>
            {slotOrDefault(
              heading,
              <div>
                <h2 className="font-bold text-3xl text-foreground tracking-tight">
                  {title}
                </h2>
                <p className="mt-3 text-muted-foreground">{description}</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {currentPrice !== undefined && (
                <PriceFormatSale
                  currencyCode={currencyCode}
                  originalPrice={currentPrice}
                  salePrice={isOnSale ? currentSalePrice : undefined}
                  showSavePercentage
                  className="items-baseline"
                  classNameOriginalPrice="text-lg text-muted-foreground line-through"
                  classNameSalePrice="text-3xl font-bold text-primary"
                  classNameSalePercentage="bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded-md"
                />
              )}

              {shippingInfo && (
                <p className="mt-1 inline-flex items-center text-muted-foreground text-sm">
                  <Clock className="mr-1 h-4 w-4" />
                  {shippingInfo}
                </p>
              )}
            </div>

            {inStock ? (
              <div className="rounded-md bg-secondary p-3 text-secondary-foreground">
                <p className="font-bold text-sm">{t("inStock")}</p>
                {availableQuantity !== null &&
                  availableQuantity !== undefined &&
                  availableQuantity > 0 && (
                    <span className="mt-1 font-normal text-sm">
                      {t("unitsAvailable", { count: availableQuantity })}
                    </span>
                  )}
              </div>
            ) : (
              <div className="rounded-md bg-destructive/10 p-3 text-destructive">
                <p className="font-bold text-sm">
                  {t(
                    selectionUnavailable
                      ? "combinationUnavailable"
                      : "currentlyOutOfStock"
                  )}
                </p>
              </div>
            )}

            {optionSelector ?? (
              <div className="space-y-6">
                <div>
                  <p className="mb-2 font-medium text-muted-foreground text-sm">
                    {variantLabel}
                  </p>
                  <VariantSelectorBasic
                    label={variantLabel}
                    value={selectedVariant.value}
                    onValueChange={handleVariantChange}
                    variants={variantsWithStockIndicator}
                    className="grid-cols-2 sm:grid-cols-2"
                    itemClassName="bg-muted border border-border hover:border-primary
                                data-[state=checked]:border-primary data-[state=checked]:bg-accent
                                data-[state=checked]:text-accent-foreground
                                focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:border-primary"
                  />
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 font-medium text-muted-foreground text-sm">
                {t("quantity")}
              </p>
              <QuantityInputBasic
                quantity={quantity}
                onChange={handleQuantityChange}
                max={availableQuantity ?? undefined}
                min={1}
                className="max-w-[150px] border-border"
                disabled={!inStock}
              />
            </div>

            <div className="mt-2 flex flex-col flex-wrap gap-3 sm:flex-row">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleAddToCart}
                disabled={!inStock || isLoading || currentPrice === undefined}
              >
                {isLoading ? t("loading") : t("addToCart")}
              </Button>
              <Button
                className="w-full"
                onClick={handleQuoteRequest}
                disabled={isLoading || selectionUnavailable}
              >
                {isLoading ? t("loading") : t("quoteRequest")}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="font-medium text-foreground">
                {t("selectedConfiguration")}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-primary" />
                  <p className="text-muted-foreground">
                    {selectionUnavailable
                      ? t("combinationUnavailable")
                      : selectedVariant.label}
                  </p>
                </div>
                {currentPrice !== undefined && (
                  <p className="font-medium text-primary">
                    {isOnSale ? (
                      <span>
                        <span className="mr-2 line-through opacity-70">
                          {format.number(
                            currentPrice,
                            "wholeMoneyWithCurrency",
                            { currency: currencyCode }
                          )}
                        </span>
                        {format.number(
                          currentSalePrice ?? currentPrice,
                          "wholeMoneyWithCurrency",
                          { currency: currencyCode }
                        )}
                      </span>
                    ) : (
                      format.number(currentPrice, "wholeMoneyWithCurrency", {
                        currency: currencyCode,
                      })
                    )}
                  </p>
                )}
              </div>
              {effectivePrice !== undefined && (
                <p className="mt-2 text-muted-foreground text-xs">
                  {quantity} {t("units", { count: quantity })} ×{" "}
                  {format.number(effectivePrice, "wholeMoneyWithCurrency", {
                    currency: currencyCode,
                  })}{" "}
                  ={" "}
                  {format.number(
                    quantity * effectivePrice,
                    "wholeMoneyWithCurrency",
                    { currency: currencyCode }
                  )}
                </p>
              )}
              <p className="mt-1 text-muted-foreground text-xs">
                {inStock ? t("inStock") : t("outOfStock")}
                {inStock &&
                  availableQuantity !== null &&
                  availableQuantity !== undefined &&
                  ` (${t("unitsAvailable", { count: availableQuantity })})`}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ProductVariant;
export type { ProductVariantProps, VariantItem, VariantSelectionPayload };
