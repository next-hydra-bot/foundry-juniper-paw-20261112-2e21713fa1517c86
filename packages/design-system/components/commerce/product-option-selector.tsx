"use client";

import * as RadioGroup from "@radix-ui/react-radio-group";
import { cn } from "@repo/design-system/lib/utils";
import { useTranslations } from "@repo/i18n";
import Image from "next/image";
import { useId } from "react";

export interface ProductOptionControl {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
  readonly values: readonly {
    readonly key: string;
    readonly label: string;
    readonly exists: boolean;
    readonly available: boolean;
    readonly swatch?: {
      readonly color?: string;
      readonly image?: { readonly url: string; readonly altText?: string };
    };
  }[];
}

export function ProductOptionSelector({
  options,
  onValueChange,
}: {
  readonly options: readonly ProductOptionControl[];
  readonly onValueChange: (key: string, value: string) => void;
}) {
  const prefix = useId();
  const t = useTranslations("web.product");
  return (
    <div className="space-y-6">
      {options.map((option) => (
        <fieldset key={option.key}>
          <legend className="mb-2 font-medium text-muted-foreground text-sm">
            {option.label}
          </legend>
          <RadioGroup.Root
            aria-label={option.label}
            value={option.value ?? ""}
            onValueChange={(value) => {
              onValueChange(option.key, value);
            }}
            className="flex flex-wrap gap-3"
          >
            {option.values.map((value) => {
              const id = `${prefix}-${encodeURIComponent(option.key)}-${encodeURIComponent(value.key)}`;
              const unavailable = !value.exists || !value.available;
              return (
                <RadioGroup.Item
                  key={value.key}
                  id={id}
                  value={value.key}
                  aria-label={value.label}
                  aria-describedby={
                    unavailable ? `${id}-availability` : undefined
                  }
                  data-commerce-product-option=""
                  data-product-option-name={option.label}
                  data-product-option-value={value.label}
                  data-available={value.available}
                  data-exists={value.exists}
                  className={cn(
                    "relative flex min-h-10 min-w-12 items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:border-primary data-[state=checked]:bg-accent",
                    unavailable && "text-muted-foreground line-through"
                  )}
                >
                  {value.swatch && (
                    <span
                      aria-hidden="true"
                      className="relative size-6 overflow-hidden rounded-full border border-border"
                      style={{ backgroundColor: value.swatch.color }}
                    >
                      {value.swatch.image && (
                        <Image
                          src={value.swatch.image.url}
                          alt=""
                          fill
                          sizes="24px"
                          className="object-cover"
                        />
                      )}
                    </span>
                  )}
                  <span>{value.label}</span>
                  {unavailable && (
                    <span id={`${id}-availability`} className="sr-only">
                      {value.exists
                        ? t("currentlyOutOfStock")
                        : t("combinationUnavailable")}
                    </span>
                  )}
                </RadioGroup.Item>
              );
            })}
          </RadioGroup.Root>
        </fieldset>
      ))}
    </div>
  );
}
