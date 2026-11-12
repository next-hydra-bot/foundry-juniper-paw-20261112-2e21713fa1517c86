import { describe, expect, it } from "@effect/vitest";
import {
  CommerceCustomerId,
  CommerceCustomerProfile,
} from "@repo/commerce-core/domain/commerce-account";
import {
  AuthUserId,
  B2CPurchasingContextRequest,
  CustomerCommerceContextRequest,
  AnonymousCommerceContextRequest,
} from "@repo/commerce-core/domain/commerce-request-context";
import { CommerceAccounts } from "@repo/commerce-core/services/commerce-accounts";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CommerceLocale, resolveStore } from "@repo/commerce-core/store";
import { Effect, Layer, Redacted } from "effect";

import { b2cPurchasingContextLayer } from "./commerce-context";

const store = resolveStore({ locale: CommerceLocale.make("en-US") });
const authUserId = AuthUserId.make("retail-user");
const customerId = CommerceCustomerId.make("retail-customer");
const profile = new CommerceCustomerProfile({
  customerId,
  email: Redacted.make("customer@example.com", { label: "email" }),
  firstName: Redacted.make("Grace", { label: "personName" }),
  lastName: Redacted.make("Hopper", { label: "personName" }),
});
const request = new B2CPurchasingContextRequest({ authUserId, store });
const accounts = CommerceAccounts.layerMemoryFrom({
  customerProfiles: [profile],
  customers: [{ authUserId, customerId }],
});
const layer = b2cPurchasingContextLayer(request).pipe(Layer.provide(accounts));

describe("personal purchasing", () => {
  it.effect(
    "resolves a linked Customer and profile without any company membership",
    () =>
      Effect.gen(function* () {
        const principal = yield* CommerceContext.customerPrincipal();
        expect(principal).toMatchObject({
          _tag: "B2CPurchasingPrincipal",
          authUserId,
          customerId,
        });
        expect(yield* CommerceContext.customerProfile()).toStrictEqual(profile);
        expect(
          yield* Effect.flip(CommerceContext.companyPrincipal())
        ).toMatchObject({ reason: "noBuyingContext" });
      }).pipe(Effect.provide(layer))
  );
  it.effect(
    "does not fall back to anonymous authority when the Customer mapping is missing",
    () =>
      Effect.void.pipe(
        Effect.provide(
          b2cPurchasingContextLayer(request).pipe(
            Layer.provide(CommerceAccounts.layerMemory)
          )
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({ reason: "noCustomerMapping" });
          return error;
        })
      )
  );
  it.effect(
    "rejects a company selector rather than treating it as personal authority",
    () =>
      Effect.void.pipe(
        Effect.provide(
          b2cPurchasingContextLayer(
            new CustomerCommerceContextRequest({ authUserId, store })
          ).pipe(Layer.provide(accounts))
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({ reason: "noBuyingContext" });
          return error;
        })
      )
  );
  it.effect(
    "supports anonymous personal shopping without a Customer profile",
    () =>
      Effect.gen(function* () {
        expect((yield* CommerceContext).principal._tag).toBe(
          "AnonymousCommercePrincipal"
        );
        expect(
          yield* Effect.flip(CommerceContext.customerProfile())
        ).toMatchObject({ reason: "noPrincipal" });
      }).pipe(
        Effect.provide(
          b2cPurchasingContextLayer(
            new AnonymousCommerceContextRequest({ store })
          ).pipe(Layer.provide(accounts))
        )
      )
  );
});
