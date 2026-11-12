"use client";

import { CustomerAreaNavigation } from "@repo/design-system/components/layout/customer-area";
import type { CustomerAreaNavigationItem } from "@repo/design-system/components/layout/customer-area";
import { useSelectedLayoutSegment } from "next/navigation";

export function AccountNavigation({
  items,
  label,
  rootHref,
}: {
  readonly items: readonly CustomerAreaNavigationItem[];
  readonly label: string;
  readonly rootHref: string;
}) {
  const segment = useSelectedLayoutSegment();
  const currentHref = segment === null ? rootHref : `${rootHref}/${segment}`;
  return (
    <CustomerAreaNavigation
      items={items}
      label={label}
      currentHref={currentHref}
    />
  );
}
