import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Option, Schema } from "effect";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { FindEmailOrderInput } from "../domain/order-access";
import type { OrderDetail } from "../domain/order-history";
import { emailOrderAccessCookieName } from "./email-access";
import { OrderDetailView } from "./pages";
import type { OrderPageResult } from "./presentation";

export const EmailOrderPage = async ({
  locale,
  orderId,
  load,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly load: (
    input: FindEmailOrderInput
  ) => Promise<OrderPageResult<Option.Option<OrderDetail>>>;
}) => {
  await connection();
  const jar = await cookies();
  const input = Schema.decodeUnknownOption(
    Schema.toCodecJson(FindEmailOrderInput)
  )({
    id: orderId,
    locale,
    token: jar.get(emailOrderAccessCookieName(orderId))?.value,
  });
  if (Option.isNone(input)) {
    notFound();
  }
  const result = await load(input.value);
  const t = await getTranslations({ locale, namespace: "web.orderHistory" });
  return (
    <OrderDetailView
      locale={locale}
      input={{
        id: input.value.id,
        locale: input.value.locale,
        stores: { _tag: "AllStores" },
      }}
      result={result}
      t={t}
      emailAccess
    />
  );
};
