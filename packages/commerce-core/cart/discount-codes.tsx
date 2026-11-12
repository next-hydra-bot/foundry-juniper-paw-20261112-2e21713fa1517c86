"use client";

import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import { useTranslations } from "@repo/i18n";
import { useId, useState } from "react";

import type { CartDiscountCode } from "../domain/promotions";
import type { ChangeCartDiscountCodeInput } from "./change-cart-discount-code";

export function DiscountCodes({
  discountCodes,
  changeDiscountCode,
}: {
  readonly discountCodes: readonly CartDiscountCode[];
  readonly changeDiscountCode: (
    input: ChangeCartDiscountCodeInput
  ) => Promise<boolean>;
}) {
  const t = useTranslations("web.cart.promotions");
  const id = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const update = async (action: "add" | "remove", value: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const success = await changeDiscountCode({ action, code: value.trim() });
      setFailed(!success);
      if (success && action === "add") {
        setCode("");
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void update("add", code);
        }}
      >
        <label htmlFor={id} className="text-sm font-medium">
          {t("code")}
        </label>
        <div className="mt-1 flex gap-2">
          <Input
            id={id}
            value={code}
            maxLength={255}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            disabled={busy}
            autoComplete="off"
          />
          <Button
            type="submit"
            variant="outline"
            disabled={busy || code.trim().length === 0}
          >
            {t("apply")}
          </Button>
        </div>
      </form>
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("failed")}
        </p>
      )}
      <ul className="space-y-2" aria-live="polite">
        {discountCodes.map(({ code: value, applicable }) => (
          <li key={value} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span>{value}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t("remove", { code: value })}
                onClick={() => {
                  void update("remove", value);
                }}
              >
                {t("removeButton")}
              </Button>
            </div>
            {!applicable && (
              <p className="text-muted-foreground">{t("inapplicable")}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
