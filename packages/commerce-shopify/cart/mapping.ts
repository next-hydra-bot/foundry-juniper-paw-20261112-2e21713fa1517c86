import { createHash } from "node:crypto";

import { CartSnapshot } from "@repo/commerce-core/domain/cart-snapshot";
import type { CartDiscount } from "@repo/commerce-core/domain/promotions";
import type { Store } from "@repo/commerce-core/store";
import { Schema } from "effect";

import { mapMoney } from "../client/schema";
import { optionSummary } from "../product/attributes";
import { storefrontContext } from "../store";
import type { ShopifyCart } from "./schema";

/** The public correlation identity is never the credential-bearing Shopify cart ID. */
export const publicCartId = (id: string) =>
  createHash("sha256").update(id).digest("hex");
export const mapCart = (
  cart: ShopifyCart,
  store: Store,
  customerId?: string,
  companyLocationId?: string
) => {
  if (
    cart.storeAttribution?.value !== store.storeKey ||
    cart.buyerIdentity.purchasingCompany?.location.id !== companyLocationId ||
    cart.buyerIdentity.countryCode !== storefrontContext(store).country ||
    (cart.buyerIdentity.customer?.id ?? undefined) !== customerId
  ) {
    throw new Error(
      "Shopify cart does not match the buyer and selling context"
    );
  }
  return Schema.decodeSync(CartSnapshot)({
    buyingContext: companyLocationId
      ? { businessUnitId: companyLocationId }
      : undefined,
    checkoutDetails: {},
    customerId,
    discountCodes: cart.discountCodes,
    discounts: cart.discountApplications
      .map(
        (discount): CartDiscount => ({
          amount: mapMoney(discount.totalAllocatedAmount, store),
          label: discount.label,
          target:
            discount.targetType === "SHIPPING_LINE" ? "shipping" : "items",
        })
      )
      .filter(({ amount }) => amount.centAmount > 0),
    id: publicCartId(cart.id),
    lineItems: cart.lines.nodes.map((line) => ({
      discounts: line.discountAllocations.map(
        (discount): CartDiscount => ({
          amount: mapMoney(discount.discountedAmount, store),
          label: discount.sourceDiscountApplication.label,
          target: "items",
        })
      ),
      id: line.id,
      quantity: line.quantity,
      regularUnitPrice:
        line.cost.compareAtAmountPerQuantity === null
          ? undefined
          : mapMoney(line.cost.compareAtAmountPerQuantity, store),
      subtotalPrice: mapMoney(line.cost.subtotalAmount, store),
      totalPrice: mapMoney(line.cost.totalAmount, store),
      unitPrice: mapMoney(line.cost.amountPerQuantity, store),
      variant: {
        id: line.merchandise.id,
        images: line.merchandise.image
          ? [
              {
                altText: line.merchandise.image.altText ?? undefined,
                url: line.merchandise.image.url,
              },
            ]
          : [],
        name: line.merchandise.product.title,
        productId: line.merchandise.product.id,
        sku:
          line.merchandise.sku === ""
            ? undefined
            : (line.merchandise.sku ?? undefined),
        summaryAttribute: optionSummary(line.merchandise.selectedOptions),
      },
    })),
    status: "active",
    storeKey: cart.storeAttribution.value,
    subtotalPrice: {
      centAmount: cart.lines.nodes.reduce(
        (sum, line) =>
          sum + mapMoney(line.cost.subtotalAmount, store).centAmount,
        0
      ),
      currencyCode: store.currency,
    },
    totalLineItemQuantity: cart.totalQuantity,
    totalPrice: mapMoney(cart.cost.totalAmount, store),
    // Shopify finalizes taxes in hosted checkout, not the Storefront Cart API.
    tax: { status: "unknown" },
    totalPriceEstimated: true,
  });
};
