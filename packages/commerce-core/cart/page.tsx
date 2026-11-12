import { getTranslations } from "@repo/i18n";
import { Suspense } from "react";

import { CartPageContent } from "./cart-flyout";
import type { CartFlyoutLinks } from "./cart-flyout";

export async function CartPage(links: CartFlyoutLinks = {}) {
  const t = await getTranslations("web.cart");
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <h1 className="text-3xl font-bold">{t("pageTitle")}</h1>
      <Suspense fallback={null}>
        <CartPageContent {...links} />
      </Suspense>
    </main>
  );
}
