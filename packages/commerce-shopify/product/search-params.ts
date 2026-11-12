type ProductSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** Normalize Shopify order/email links before they enter the shared product page. */
export async function withShopifyProductSearchParams(
  searchParams: Promise<ProductSearchParams>
): Promise<ProductSearchParams> {
  const query = await searchParams;
  const { variant } = query;
  let normalized = query;
  if (
    variant !== undefined &&
    !Array.isArray(variant) &&
    /^[0-9]+$/u.test(variant)
  ) {
    normalized = {
      ...normalized,
      variant: `gid://shopify/ProductVariant/${variant}`,
    };
  }
  const references = query.option_values;
  if (
    references !== undefined &&
    !Array.isArray(references) &&
    /^[0-9]+(?:,[0-9]+)*$/u.test(references)
  ) {
    normalized = {
      ...normalized,
      option_values: references
        .split(",")
        .map((id) => `gid://shopify/ProductOptionValue/${id}`)
        .join(","),
    };
  }
  return normalized;
}
