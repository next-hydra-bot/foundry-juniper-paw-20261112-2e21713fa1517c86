import { ActionClient, ActionMiddleware } from "@repo/actions";
import "server-only";
import type { EmptyActionContext } from "@repo/actions";
import type { NextServer } from "@repo/actions/next-server";
import type { CommerceContextRequest } from "@repo/commerce-core/domain/commerce-request-context";
import type { AddressBook } from "@repo/commerce-core/services/address-book";
import type { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import type { StoreKey } from "@repo/commerce-core/store";
import { defaultLocale } from "@repo/i18n/config";
import type { Locale } from "@repo/i18n/types";
import { Effect, Layer, ManagedRuntime } from "effect";

import type { CommerceRequestProvisionError } from "./make-commerce-base-app";

export interface CommerceRequestOptions {
  readonly selectedStoreKey?: StoreKey;
}

export type NextCommerceRequestError = CommerceRequestProvisionError;

export type CommerceActionClient<
  ActionServices,
  RuntimeServices,
  Context extends object,
> = ActionClient<
  RuntimeServices | ActionServices,
  NextCommerceRequestError,
  RuntimeServices,
  Context,
  "Provided"
>;

// oxlint-disable-next-line unicorn/custom-error-definition -- This public binding names a missing host configuration.
export class CommerceRuntimeNotConfigured extends Error {
  override readonly name = "CommerceRuntimeNotConfigured";

  constructor() {
    super(
      "The Commerce application runtime is not configured. Check the installed recipe's runtime alias and import its public @repo/.../bindings entry."
    );
  }
}

/** Typed fallbacks for recipe-supplied application aliases; never selects a provider. */
export const unconfiguredNextCommerceBinding = <
  RequestServices,
  StableServices,
>() => {
  const unconfiguredLayer: Layer.Layer<StableServices | NextServer> =
    Layer.effectContext(Effect.die(new CommerceRuntimeNotConfigured()));
  const runtime = ManagedRuntime.make(unconfiguredLayer);
  const actionContext = ActionMiddleware.context<
    EmptyActionContext,
    { readonly locale: Locale }
  >(() => Effect.succeed({ locale: defaultLocale }));
  const requestLayer = (): Layer.Layer<
    RequestServices,
    CommerceRequestProvisionError,
    StableServices
  > => Layer.effectContext(Effect.die(new CommerceRuntimeNotConfigured()));

  return {
    Actions: ActionClient.make(runtime).use(actionContext),
    CommerceActions: ActionClient.make(runtime)
      .use(actionContext)
      .provide(requestLayer),
    NextCommerce: {
      provide:
        (_locale: Locale, _options?: CommerceRequestOptions) =>
        <A, E>(
          _program: Effect.Effect<A, E, RequestServices | StableServices>
        ): Effect.Effect<
          A,
          E | NextCommerceRequestError,
          StableServices | NextServer
        > =>
          Effect.die(new CommerceRuntimeNotConfigured()),
      provideAddressBook:
        (_request: CommerceContextRequest) =>
        <A, E>(
          _program: Effect.Effect<A, E, AddressBook | CommerceContext>
        ): Effect.Effect<
          A,
          E | NextCommerceRequestError,
          StableServices | NextServer
        > =>
          Effect.die(new CommerceRuntimeNotConfigured()),
      provideContext:
        (_locale: Locale, _options?: CommerceRequestOptions) =>
        <A, E>(
          _program: Effect.Effect<A, E, CommerceContext | StableServices>
        ): Effect.Effect<
          A,
          E | NextCommerceRequestError,
          StableServices | NextServer
        > =>
          Effect.die(new CommerceRuntimeNotConfigured()),
      runPromise: async <A, E>(
        _program: Effect.Effect<A, E, StableServices | NextServer>
      ): Promise<A> => await Promise.reject(new CommerceRuntimeNotConfigured()),
    },
  };
};
