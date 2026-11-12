import "server-only";
import { AuthUserId } from "@repo/auth-contract/access-token";
import type { CustomerAccountPageProps } from "@repo/commerce-b2c/customer-account";
import { B2CPurchasingPrincipal } from "@repo/commerce-core/domain/commerce-request-context";
import {
  orderHistoryInput,
  orderHistorySearch,
} from "@repo/commerce-core/orders/history-selection";
import {
  OrderDetailPage,
  OrderListingPage,
} from "@repo/commerce-core/orders/pages";
import type { OrderSearchParams } from "@repo/commerce-core/orders/pages";
import { presentOrderRead } from "@repo/commerce-core/orders/presentation";
import { OrderQueries } from "@repo/commerce-core/services/order-queries";
import { CommerceLocale } from "@repo/commerce-core/store";
import { NextCommerce } from "@repo/commerce-shopify/customer-account/bindings";
import { Button } from "@repo/design-system/components/ui/button";
import { getTranslations } from "@repo/i18n";
import { Config, Effect, Layer, Option } from "effect";

import { ShopifyCompanyAdmin } from "../company/admin";
import { companyStorageLayer } from "../company/storage";
import { requireCustomerAccountUser } from "./account-page";
import {
  findCustomerByIdentitySubject,
  findLinkedCustomerId,
} from "./identity-links";

type OrderHistoryProps = Pick<CustomerAccountPageProps, "auth" | "locale"> & {
  readonly searchParams: OrderSearchParams;
};

const identities = companyStorageLayer("identities");

async function orderHistoryAccess(auth: OrderHistoryProps["auth"]) {
  const user = await requireCustomerAccountUser(auth);
  const authUserId = AuthUserId.make(user.id);
  const link = await NextCommerce.runPromise(
    Effect.gen(function* () {
      const linked = yield* findLinkedCustomerId(authUserId);
      if (linked || !user.email) {
        return linked;
      }
      const name = yield* Config.option(
        Config.String("SHOPIFY_CUSTOMER_IDENTITY_PROVIDER_NAME")
      );
      const providerName = Option.getOrUndefined(name)?.trim();
      if (!providerName) {
        return undefined;
      }
      return yield* findCustomerByIdentitySubject({
        authUserId,
        email: user.email,
        providerName,
      });
    }).pipe(
      Effect.provide(
        identities.pipe(Layer.provideMerge(ShopifyCompanyAdmin.layer))
      ),
      presentOrderRead
    )
  );
  if (link.error) {
    return { error: link.error };
  }
  if (link.value) {
    return {
      principal: new B2CPurchasingPrincipal({
        authUserId,
        customerId: link.value,
      }),
    };
  }

  return {};
}

async function FindPreviousOrders({
  locale,
  searchParams,
}: Pick<OrderHistoryProps, "locale" | "searchParams">) {
  const input = orderHistoryInput(
    CommerceLocale.make(locale),
    searchParams,
    "personal"
  );
  if (Option.isNone(input)) {
    return null;
  }
  const path = `/${locale}/account/orders`;
  const search = orderHistorySearch(input.value);
  const query = new URLSearchParams({
    purpose: "account",
    return_to: search.size ? `${path}?${search}` : path,
  });
  const t = await getTranslations({ locale, namespace: "web.orderHistory" });
  return (
    <Button asChild variant="ghost">
      <a href={`/account/login?${query}`}>{t("findPreviousOrders")}</a>
    </Button>
  );
}

export async function CustomerOrderListingPage(props: OrderHistoryProps) {
  const { locale, searchParams } = props;
  const { principal, error } = await orderHistoryAccess(props.auth);
  return (
    <OrderListingPage
      mode="personal"
      emptyAction={
        !principal && !error ? (
          <FindPreviousOrders locale={locale} searchParams={searchParams} />
        ) : undefined
      }
      locale={locale}
      searchParams={searchParams}
      load={async (input) => {
        if (error) {
          return { error };
        }
        if (!principal) {
          return { value: { items: [] } };
        }
        return await NextCommerce.runPromise(
          OrderQueries.pipe(
            Effect.flatMap((orders) => orders.list(principal, input)),
            presentOrderRead
          )
        );
      }}
    />
  );
}

export async function CustomerOrderDetailPage(
  props: OrderHistoryProps & { readonly orderId: string }
) {
  const { locale, orderId, searchParams } = props;
  const { principal, error } = await orderHistoryAccess(props.auth);
  return (
    <OrderDetailPage
      mode="personal"
      locale={locale}
      orderId={orderId}
      searchParams={searchParams}
      load={async (input) => {
        if (error) {
          return { error };
        }
        if (!principal) {
          return { value: Option.none() };
        }
        return await NextCommerce.runPromise(
          OrderQueries.pipe(
            Effect.flatMap((orders) => orders.findById(principal, input)),
            presentOrderRead
          )
        );
      }}
    />
  );
}
