import { Schema } from "effect";

/** URL selection uses stable option keys and opaque provider references. */
export type ProductSelectionQuery = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

interface SelectionModel {
  readonly defaultVariantId: string;
  readonly options: readonly {
    readonly key: string;
    readonly values: readonly { readonly key: string; readonly id?: string }[];
  }[];
  readonly variants: readonly {
    readonly id: string;
    readonly optionValues: Readonly<Record<string, string>>;
    readonly isInStock: boolean;
  }[];
}

export interface ProductSelection {
  readonly optionValues: Readonly<Record<string, string>>;
  readonly variantId?: string;
  readonly invalidInput?: boolean;
}

const singleValue = (value: ProductSelectionQuery[string]) =>
  Schema.is(Schema.String)(value) ? value : undefined;

export const resolveProductOptions = (
  product: SelectionModel,
  values: Readonly<Record<string, string>>,
  valid = true
): ProductSelection => {
  const fallback =
    product.variants.find(({ id }) => id === product.defaultVariantId) ??
    product.variants[0];
  const entries = Object.entries(values);
  const defined = entries.every(([key, value]) =>
    product.options.some(
      (option) =>
        option.key === key &&
        option.values.some((candidate) => candidate.key === value)
    )
  );
  const candidates =
    valid && defined
      ? product.variants.filter((variant) =>
          entries.every(([key, value]) => variant.optionValues[key] === value)
        )
      : [];
  const selected =
    candidates.find(({ id }) => id === product.defaultVariantId) ??
    candidates.find(({ isInStock }) => isInStock) ??
    candidates[0];
  let selection: ProductSelection = {
    optionValues: { ...(selected ?? fallback)?.optionValues, ...values },
  };
  if (selected !== undefined) {
    selection = { ...selection, variantId: selected.id };
  }
  if (!valid || !defined) {
    selection = { ...selection, invalidInput: true };
  }
  return selection;
};

export const resolveProductSelection = (
  product: SelectionModel,
  query: ProductSelectionQuery = {}
): ProductSelection => {
  const reference = singleValue(query.variant);
  const explicit = product.variants.find(({ id }) => id === reference);
  if (explicit !== undefined) {
    return { optionValues: explicit.optionValues, variantId: explicit.id };
  }
  const values: Record<string, string> = {};
  let valid = true;
  const references = singleValue(query.option_values);
  if (query.option_values !== undefined) {
    const ids = references?.split(",") ?? [];
    valid = ids.length === product.options.length && ids.length > 0;
    for (const id of ids) {
      const option = product.options.find((candidate) =>
        candidate.values.some((value) => value.id === id)
      );
      const value = option?.values.find((candidate) => candidate.id === id);
      if (
        option === undefined ||
        value === undefined ||
        values[option.key] !== undefined
      ) {
        valid = false;
      } else {
        values[option.key] = value.key;
      }
    }
  }
  for (const [parameter, raw] of Object.entries(query)) {
    if (!parameter.startsWith("option.")) {
      continue;
    }
    const key = parameter.slice("option.".length);
    const value = singleValue(raw);
    if (
      !product.options.some((option) => option.key === key) ||
      value === undefined
    ) {
      valid = false;
    } else {
      values[key] = value;
    }
  }
  return resolveProductOptions(product, values, valid);
};

export const productSelectionQuery = (
  params: URLSearchParams
): ProductSelectionQuery =>
  Object.fromEntries(
    Array.from(new Set(params.keys()), (key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    })
  );

export const writeProductSelection = (
  url: URL,
  product: SelectionModel,
  selection: ProductSelection
): string => {
  url.searchParams.delete("variant");
  url.searchParams.delete("option_values");
  const selectionKeys = [...url.searchParams.keys()].filter((key) =>
    key.startsWith("option.")
  );
  for (const key of selectionKeys) {
    url.searchParams.delete(key);
  }
  if (product.options.length === 0 && selection.variantId !== undefined) {
    url.searchParams.set("variant", selection.variantId);
  } else {
    for (const option of product.options) {
      const value = selection.optionValues[option.key];
      if (value !== undefined) {
        url.searchParams.set(`option.${option.key}`, value);
      }
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
};
