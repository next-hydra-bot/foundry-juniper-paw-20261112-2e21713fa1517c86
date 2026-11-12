"use client";


import {
  ProductDetail as ProductDetailView,
  ProductDetailHeading,
  ProductDetailLayout,
  ProductDetailMedia,
  ProductDetailPurchase,
} from "@repo/design-system/components/commerce/blocks/product-detail";
import ProductVariant from "@repo/design-system/components/commerce/blocks/product-variants";
import type { VariantSelectionPayload } from "@repo/design-system/components/commerce/blocks/product-variants";
import ImageViewer from "@repo/design-system/components/commerce/image-viewer-basic";
import { ProductOptionSelector } from "@repo/design-system/components/commerce/product-option-selector";
import { QuoteRequestDialog } from "@repo/design-system/components/quote-request-dialog";
import { useTranslations } from "@repo/i18n";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { useCart } from "../cart/cart-context";
import {
  productSelectionQuery,
  resolveProductOptions,
  resolveProductSelection,
  writeProductSelection,
} from "./option-selection";
import type { ProductSelection } from "./option-selection";
import type {
  ProductDetailPresentation,
  ProductOptionPresentation,
} from "./presentation";

const noOptions: readonly ProductOptionPresentation[] = [];

function useProductSelectionState({
  defaultVariantId,
  initialSelection,
  initialQuery,
  options = noOptions,
  variants,
}: ProductDetailPresentation) {
  const selectionModel = useMemo(
    () => ({
      defaultVariantId,
      options,
      variants: variants.map((variant) => ({
        ...variant,
        optionValues: variant.optionValues ?? {},
      })),
    }),
    [defaultVariantId, options, variants]
  );
  const [selection, setSelection] = useState<ProductSelection>(
    initialSelection ?? resolveProductSelection(selectionModel)
  );
  const restored = useRef(false);
  const [quantity, setQuantity] = useState<number>(1);

  const select = setSelection;

  useEffect(() => {
    const restoreSelection = (first = false) => {
      const url = new URL(window.location.href);
      const query = productSelectionQuery(url.searchParams);
      let next = resolveProductSelection(selectionModel, query);
      const knownVariant = variants.some(({ id }) => id === query.variant);
      const translated =
        initialQuery !== undefined &&
        ((query.variant !== undefined &&
          query.variant !== initialQuery.variant &&
          !knownVariant) ||
          (query.option_values !== undefined &&
            query.option_values !== initialQuery.option_values &&
            next.invalidInput));
      if (first && translated) {
        next = resolveProductSelection(selectionModel, initialQuery);
        if (!next.invalidInput) {
          window.history.replaceState(
            null,
            "",
            writeProductSelection(url, selectionModel, next)
          );
        }
      }
      select(next);
    };
    // Activity reconnects effects on reveal; the current URL wins over the cached server seed.
    restoreSelection(!restored.current);
    restored.current = true;
    const handlePopState = () => {
      restoreSelection();
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [initialQuery, select, selectionModel, variants]);

  const updateSelection = useCallback(
    (next: ProductSelection) => {
      select(next);
      const destination = writeProductSelection(
        new URL(window.location.href),
        selectionModel,
        next
      );
      if (
        destination !==
        `${window.location.pathname}${window.location.search}${window.location.hash}`
      ) {
        window.history.pushState(null, "", destination);
      }
    },
    [select, selectionModel]
  );

  const handleVariantChange = useCallback(
    (id: string) => {
      updateSelection(resolveProductSelection(selectionModel, { variant: id }));
    },
    [selectionModel, updateSelection]
  );

  const handleOptionChange = useCallback(
    (key: string, value: string) => {
      updateSelection(
        resolveProductOptions(selectionModel, {
          ...selection.optionValues,
          [key]: value,
        })
      );
    },
    [selection.optionValues, selectionModel, updateSelection]
  );

  return {
    handleOptionChange,
    handleVariantChange,
    quantity,
    selection,
    selectionModel,
    setQuantity,
  };
}

const ProductSelectionContext = createContext<ReturnType<
  typeof useProductSelectionState
> | null>(null);

function useProductSelectionContext() {
  const context = useContext(ProductSelectionContext);
  if (context === null) {
    throw new Error("Product selection requires CommerceProductSelection");
  }
  return context;
}

/** Add-on controls observe the same selected Variant and quantity as purchase controls. */
export function useProductPurchaseSelection() {
  const { selection, quantity } = useProductSelectionContext();
  return { variantId: selection.variantId, quantity };
}

function ProductSelectionProvider({
  product,
  children,
}: {
  readonly product: ProductDetailPresentation;
  readonly children: ReactNode;
}) {
  const state = useProductSelectionState(product);
  return (
    <ProductSelectionContext value={state}>{children}</ProductSelectionContext>
  );
}

export function CommerceProductSelection({
  product,
  children,
}: {
  readonly product: ProductDetailPresentation;
  readonly children: ReactNode;
}) {
  return (
    <ProductSelectionProvider
      key={`${product.productId}/${JSON.stringify(product.initialQuery ?? product.initialSelection ?? {})}`}
      product={product}
    >
      {children}
    </ProductSelectionProvider>
  );
}

export function CommerceProductMedia({
  product,
}: {
  readonly product: ProductDetailPresentation;
}) {
  const { selection } = useProductSelectionContext();
  const variant = product.variants.find(({ id }) => id === selection.variantId);
  return (
    <ImageViewer
      imageTitle={product.title}
      imageUrl={variant?.imageUrl ?? product.defaultImage ?? ""}
      classNameThumbnailViewer="rounded-lg object-contain h-[300px] mx-auto"
    />
  );
}

export function CommerceProductPurchase({
  availableForSale,
  defaultImage,
  defaultVariantId,
  description,
  title,
  variantLabel,
  variants,
  options = noOptions,
}: ProductDetailPresentation) {
  const t = useTranslations("web.product");
  const { addItem } = useCart();
  const {
    selection,
    quantity,
    setQuantity,
    handleVariantChange,
    handleOptionChange,
  } = useProductSelectionContext();
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const selectionModel = {
    variants: variants.map((variant) => ({
      ...variant,
      optionValues: variant.optionValues ?? {},
    })),
  };
  const selectedVariant = variants.find(
    (variant) => variant.id === selection.variantId
  );
  useEffect(() => {
    const maximum = selectedVariant?.availableQuantity;
    if (
      selectedVariant?.isInStock &&
      maximum !== undefined &&
      maximum !== null
    ) {
      setQuantity((current) => Math.min(current, Math.max(1, maximum)));
    }
  }, [
    selectedVariant?.availableQuantity,
    selectedVariant?.isInStock,
    setQuantity,
  ]);

  const handleAddToCart = useCallback(
    async (payload: VariantSelectionPayload) => {
      await addItem({
        quantity: payload.quantity,
        variantId: payload.variantId,
      });
    },
    [addItem]
  );

  const handleQuoteRequest = useCallback(() => {
    setQuoteDialogOpen(true);
  }, []);

  const controls = options.map((option) => ({
    ...option,
    value: selection.optionValues[option.key],
    values: option.values.map((value) => {
      const matches = selectionModel.variants.filter(
        (variant) =>
          variant.optionValues[option.key] === value.key &&
          options.every(
            (other) =>
              other.key === option.key ||
              variant.optionValues[other.key] ===
                selection.optionValues[other.key]
          )
      );
      return {
        ...value,
        available: matches.some(({ isInStock }) => isInStock),
        exists: matches.length > 0,
      };
    }),
  }));

  return (
    <>
      <QuoteRequestDialog
        open={quoteDialogOpen}
        onOpenChange={setQuoteDialogOpen}
        product={title}
        variant={selectedVariant?.label ?? ""}
        price={selectedVariant?.price}
        currencyCode={selectedVariant?.currencyCode}
      />
      <ProductVariant
        media={null}
        heading={null}
        title={title}
        description={description}
        badge={availableForSale ? "" : t("outOfStock")}
        defaultImage={defaultImage}
        initialVariant={defaultVariantId}
        variants={variants}
        variantLabel={variantLabel}
        selectedVariant={selectedVariant?.value}
        selectionUnavailable={selectedVariant === undefined}
        optionSelector={
          options.length === 0 ? undefined : (
            <ProductOptionSelector
              options={controls}
              onValueChange={handleOptionChange}
            />
          )
        }
        onVariantChange={handleVariantChange}
        quantity={quantity}
        onQuantityChange={setQuantity}
        onAddToCart={(payload) => {
          void handleAddToCart(payload);
        }}
        onQuoteRequest={handleQuoteRequest}
      />
    </>
  );
}

export function CommerceProductDetail(props: ProductDetailPresentation) {
  return (
    <ProductDetailView categoryName={props.categoryName} title={props.title}>
      <ProductDetailLayout
        heading={
          <ProductDetailHeading
            title={props.title}
            description={props.description}
          />
        }
      >
        <CommerceProductSelection product={props}>
          <ProductDetailMedia>
            <CommerceProductMedia product={props} />
          </ProductDetailMedia>
          <ProductDetailPurchase>
            <CommerceProductPurchase {...props} />
          </ProductDetailPurchase>
        </CommerceProductSelection>
      </ProductDetailLayout>
    </ProductDetailView>
  );
}
