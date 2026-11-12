"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { useEffect, useRef } from "react";

import type { ShopifyCustomerAuthenticationDestination } from "./accounts";

/** OAuth handlers accept document requests; connected account pages use normal App Router navigation. */
export function CustomerAccountHandoff({
  href,
  pendingLabel,
  continueLabel,
}: {
  readonly href: ShopifyCustomerAuthenticationDestination;
  readonly pendingLabel: string;
  readonly continueLabel: string;
}) {
  const navigatingTo = useRef<string | null>(null);
  useEffect(() => {
    if (navigatingTo.current === href) {
      return;
    }
    navigatingTo.current = href;
    window.location.replace(href);
  }, [href]);
  return (
    <div className="grid justify-items-start gap-4">
      <output>{pendingLabel}</output>
      <Button variant="outline" asChild>
        <a href={href}>{continueLabel}</a>
      </Button>
    </div>
  );
}
