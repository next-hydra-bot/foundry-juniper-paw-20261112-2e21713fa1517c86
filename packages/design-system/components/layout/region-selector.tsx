"use client";

import { Button } from "@repo/design-system/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/design-system/components/ui/dropdown-menu";
import { cn } from "@repo/design-system/lib/utils";
import { Check, Globe } from "lucide-react";

export interface RegionOption {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly description?: string;
}

export interface RegionSelectorProps {
  readonly options: readonly RegionOption[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly label?: string;
}

/** Presentation only: the caller supplies options, selection and navigation. */
export const RegionSelector = ({
  options,
  selectedId,
  onSelect,
  label = "Current region",
}: RegionSelectorProps) => {
  const activeRegion = options.find(({ id }) => id === selectedId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-label={`${label} ${activeRegion?.label ?? ""}`}
        >
          <Globe className="h-4 w-4" />
          <span className="font-medium">{activeRegion?.shortLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 py-2",
              option.id === selectedId && "bg-muted"
            )}
            onSelect={() => {
              onSelect(option.id);
            }}
          >
            <Check
              className={cn(
                "h-4 w-4 transition-opacity",
                option.id === selectedId ? "opacity-100" : "opacity-0"
              )}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{option.label}</span>
              {option.description && (
                <span className="text-muted-foreground text-xs">
                  {option.description}
                </span>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
