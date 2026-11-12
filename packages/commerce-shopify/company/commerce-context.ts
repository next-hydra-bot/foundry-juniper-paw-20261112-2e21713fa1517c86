import type {
  CommerceContextRequest,
  CommerceRequestContextNotFound,
} from "@repo/commerce-core/domain/commerce-request-context";
import type { CommerceAccountUnavailable } from "@repo/commerce-core/services/commerce-accounts";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";

import { ShopifyCustomerAccounts } from "../customer-account/accounts";

/** Native company purchasing requires both site sign-in and the Shopify customer session. */
export const withCompanySession = <R>(
  request: CommerceContextRequest,
  context: Layer.Layer<
    CommerceContext,
    CommerceRequestContextNotFound | CommerceAccountUnavailable,
    R
  >
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { locale } = request.store;
      if (request._tag !== "CustomerCommerceContextRequest") {
        return yield* Effect.sync(() => redirect(`/${locale}/sign-in`));
      }
      const accounts = yield* ShopifyCustomerAccounts;
      const identity = yield* accounts.read.pipe(Effect.orDie);
      if (!identity?.accessToken) {
        const destination = yield* accounts
          .checkoutDestination(`/${locale}`)
          .pipe(Effect.orDie);
        return yield* Effect.sync(() =>
          redirect(destination ?? `/${locale}/sign-in`)
        );
      }
      return context.pipe(
        Layer.catch((error) =>
          error._tag === "CommerceRequestContextNotFound" &&
          error.reason === "noBuyingContext"
            ? Layer.effectContext(
                Effect.sync(() => redirect(`/${locale}/company`))
              )
            : Layer.effectContext(Effect.fail(error))
        )
      );
    })
  );
