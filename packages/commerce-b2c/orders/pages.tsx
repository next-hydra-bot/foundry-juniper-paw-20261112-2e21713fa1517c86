import { NextCommerce } from "@repo/commerce-b2c/bindings";
import {
  OrderDetailPage as Detail,
  OrderListingPage as Listing,
} from "@repo/commerce-core/orders/pages";
import type { OrderSearchParams } from "@repo/commerce-core/orders/pages";
import { presentOrderRead } from "@repo/commerce-core/orders/presentation";
import type { Locale } from "@repo/i18n/types";

import { findOrderDetail, listOrders } from "./programs";

export const OrderListingPage = ({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: OrderSearchParams;
}) => (
  <Listing
    mode="personal"
    locale={locale}
    searchParams={searchParams}
    load={async (input) =>
      await NextCommerce.runPromise(
        listOrders(input).pipe(
          NextCommerce.provideContext(locale),
          presentOrderRead
        )
      )
    }
  />
);
export const OrderDetailPage = ({
  locale,
  orderId,
  searchParams,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly searchParams: OrderSearchParams;
}) => (
  <Detail
    mode="personal"
    locale={locale}
    orderId={orderId}
    searchParams={searchParams}
    load={async (input) =>
      await NextCommerce.runPromise(
        findOrderDetail(input).pipe(
          NextCommerce.provideContext(locale),
          presentOrderRead
        )
      )
    }
  />
);
