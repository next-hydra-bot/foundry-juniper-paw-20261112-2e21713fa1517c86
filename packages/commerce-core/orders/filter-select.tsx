"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { useState } from "react";

/** Keep the GET form's empty value separate from Radix's non-empty option values. */
export function OrderFilterSelect({
  id,
  name,
  defaultValue = "",
  allLabel,
  options,
}: {
  readonly id: string;
  readonly name: string;
  readonly defaultValue?: string;
  readonly allLabel: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select
        value={value ? `value:${value}` : "all"}
        onValueChange={(selected) => {
          setValue(selected === "all" ? "" : selected.slice(6));
        }}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={`value:${option.value}`}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
