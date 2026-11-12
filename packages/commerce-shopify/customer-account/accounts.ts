import "server-only";
import { createHash } from "node:crypto";

import { NextRequestApi } from "@repo/actions/next-request";
import type { NextCookieStore } from "@repo/actions/next-request";
import { AuthSessionAdapter } from "@repo/auth-contract/session";
import {
  CommerceLocale,
  resolveStore,
  StoreKey,
  storeConfiguration,
} from "@repo/commerce-core/store";
import { routing } from "@repo/i18n/routing";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { createShopifyRequestContext } from "@shopify/hydrogen";
import { createCustomerSession } from "@shopify/hydrogen/customer-account";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";

import { CartCookieJson } from "../cart/schema";
import { CART_COOKIE_NAME } from "../cart/session";
import { storefrontContext } from "../store";
import { versionedKeyValueStoreLayer } from "../versioned-store";
import { readCustomerProfile } from "./client";
import { ShopifyCustomerSessionFailure } from "./failure";
import { ensureCustomerIdentity } from "./identity-links";
import { customerAccountKeys } from "./keys";
import {
  clearShopifyCookies,
  isSameOriginLogout,
  logoutRequestOrigin,
  LOGOUT_COMPLETION_PATH,
  LOGOUT_CONTINUATION_PATH,
} from "./logout";
import type { Customer } from "./session-cookie";
import { openCustomerSession } from "./session-cookie";

export { ShopifyCustomerSessionFailure } from "./failure";

const attempt = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    // SDK errors can contain OAuth payloads. Never attach them to public errors or telemetry.
    catch: () => new ShopifyCustomerSessionFailure({ reason: "unavailable" }),
    try: operation,
  });
export interface ShopifyCustomerIdentity {
  readonly authUserId: string;
  readonly scope: string;
  readonly customer: typeof Customer.Type;
  readonly accessToken?: Redacted.Redacted;
  readonly cartSynchronizationPending: boolean;
}

export type ShopifyCustomerAuthenticationDestination =
  `/account/${"login" | "refresh"}?${string}`;

const AuthenticationPurpose = Schema.Literals(["account", "checkout"]);
type AuthenticationPurpose = typeof AuthenticationPurpose.Type;
export const safeReturnTo = (value: string | null, origin: string) => {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.length > 2048
  ) {
    return "/";
  }
  const url = new URL(value, origin);
  return url.origin === origin ? `${url.pathname}${url.search}` : "/";
};

const authenticationPath = (
  path: "login" | "refresh",
  returnTo: string,
  purpose: AuthenticationPurpose,
  origin: string
): ShopifyCustomerAuthenticationDestination => {
  const query = new URLSearchParams({
    return_to: safeReturnTo(returnTo, origin),
  });
  if (purpose === "account") {
    query.set("purpose", purpose);
  }
  return `/account/${path}?${query}`;
};

const contextFor = (locale: CommerceLocale, cookies: NextCookieStore) => {
  const encoded = cookies.get(CART_COOKIE_NAME)?.value;
  const cart = encoded
    ? Option.getOrUndefined(Schema.decodeOption(CartCookieJson)(encoded))
    : undefined;
  return storefrontContext(
    resolveStore(
      {
        locale,
        selectedStoreKey:
          cart?.locale === locale
            ? Option.getOrUndefined(
                Schema.decodeOption(StoreKey)(cart.storeKey)
              )
            : undefined,
      },
      storeConfiguration
    )
  );
};

export class ShopifyCustomerAccounts extends Context.Service<
  ShopifyCustomerAccounts,
  {
    /** Read-only: safe in server components. The encrypted profile is bound to the site session. */
    readonly read: Effect.Effect<
      ShopifyCustomerIdentity | undefined,
      ShopifyCustomerSessionFailure
    >;
    /** Fresh native customer details, without writing cookies or refreshing tokens. */
    readonly profile: Effect.Effect<
      typeof Customer.Type,
      ShopifyCustomerSessionFailure
    >;
    /** Writable routes/actions only. Refreshes tokens without replaying a cart mutation. */
    readonly cartAccessToken: Effect.Effect<
      Redacted.Redacted,
      ShopifyCustomerSessionFailure
    >;
    /** Writable only: called after the current cart's buyer identity is confirmed. */
    readonly completeCartSynchronization: Effect.Effect<
      void,
      ShopifyCustomerSessionFailure
    >;
    /** Writable only: reloads native names after a profile edit without changing buyer identity. */
    readonly refreshProfile: Effect.Effect<
      typeof Customer.Type,
      ShopifyCustomerSessionFailure
    >;
    /** Read-only identity handoff. A pending cart attachment does not block account reads. */
    readonly accountDestination: (
      returnTo: string
    ) => Effect.Effect<
      ShopifyCustomerAuthenticationDestination | undefined,
      ShopifyCustomerSessionFailure
    >;
    readonly checkoutDestination: (
      returnTo: string
    ) => Effect.Effect<
      ShopifyCustomerAuthenticationDestination | undefined,
      ShopifyCustomerSessionFailure
    >;
    readonly handle: (
      request: Request
    ) => Effect.Effect<
      { readonly destination: string; readonly synchronizeCart: boolean },
      ShopifyCustomerSessionFailure
    >;
  }
>()("@repo/commerce-shopify/CustomerAccounts") {
  static readonly layerWith = ({
    environment,
    fetchApi = globalThis.fetch,
    identityStoreLayer = versionedKeyValueStoreLayer({
      container: "identities",
    }),
  }: {
    readonly environment: ReturnType<typeof customerAccountKeys>;
    readonly fetchApi?: typeof globalThis.fetch;
    readonly identityStoreLayer?: Layer.Layer<VersionedKeyValueStore>;
  }) =>
    Layer.effect(
      ShopifyCustomerAccounts,
      Effect.gen(function* () {
        const identityRecords = yield* VersionedKeyValueStore;
        const auth = yield* AuthSessionAdapter;
        const next = yield* NextRequestApi;
        const origin = environment.SHOPIFY_STOREFRONT_ORIGIN;
        const sdk = createCustomerSession({
          customerAccountApiClientId:
            environment.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
          fetch: fetchApi,
          shopId: environment.SHOPIFY_SHOP_ID,
        });
        const requestContext = (
          i18n: ReturnType<typeof storefrontContext>,
          request?: Request
        ) =>
          createShopifyRequestContext({
            i18n,
            request: request ?? { headers: new Headers(), url: origin },
          });
        const transientSession = (
          cookies: NextCookieStore,
          purpose: "logout" | "recovery"
        ) =>
          openCustomerSession({
            cookieName: `shopify-${purpose}`,
            cookies,
            maxAge: 120,
            origin,
            scope: JSON.stringify([
              environment.SHOPIFY_SHOP_ID,
              environment.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
              origin,
              purpose,
            ]),
            secret: environment.SHOPIFY_CUSTOMER_SESSION_SECRET,
          });
        const load = Effect.gen(function* () {
          const session = yield* auth.read.pipe(
            Effect.mapError(
              () => new ShopifyCustomerSessionFailure({ reason: "unavailable" })
            )
          );
          if (!session.user) {
            return undefined;
          }
          if (!session.sessionId) {
            return yield* new ShopifyCustomerSessionFailure({
              reason: "unauthenticated",
            });
          }
          const scope = createHash("sha256")
            .update(
              JSON.stringify([
                environment.SHOPIFY_SHOP_ID,
                environment.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
                session.user.id,
                session.sessionId,
              ])
            )
            .digest("hex");
          const cookies = yield* next.getCookies();
          const i18n = contextFor(
            CommerceLocale.make(yield* next.getLocale()),
            cookies
          );
          const storage = openCustomerSession({
            cookies,
            origin,
            scope,
            secret: environment.SHOPIFY_CUSTOMER_SESSION_SECRET,
          });
          return { cookies, i18n, scope, storage, user: session.user };
        });
        const read = Effect.gen(function* () {
          const loaded = yield* load;
          if (!loaded) {
            return undefined;
          }
          const customer = loaded.storage.customer();
          const loggedIn = yield* attempt(
            async () =>
              await sdk.isLoggedIn(
                loaded.storage.manager,
                requestContext(loaded.i18n)
              )
          );
          if (!customer || !loggedIn) {
            return undefined;
          }
          const token = yield* attempt(
            async () =>
              await sdk.getAccessToken(
                loaded.storage.manager,
                requestContext(loaded.i18n)
              )
          );
          return {
            accessToken: token ? Redacted.make(token) : undefined,
            authUserId: loaded.user.id,
            cartSynchronizationPending:
              loaded.storage.cartSynchronizationPending(),
            customer,
            scope: loaded.scope,
          };
        });
        const profile = (
          accessToken: string,
          i18n: ReturnType<typeof storefrontContext>,
          request?: Request
        ) =>
          readCustomerProfile({
            accessToken,
            fetchApi,
            i18n,
            request: request ?? { headers: new Headers(), url: origin },
            shopId: environment.SHOPIFY_SHOP_ID,
          });
        const requireSession = load.pipe(
          Effect.flatMap((loaded) =>
            loaded
              ? Effect.succeed(loaded)
              : new ShopifyCustomerSessionFailure({ reason: "unauthenticated" })
          )
        );
        const readProfile = Effect.gen(function* () {
          const loaded = yield* requireSession;
          const current = yield* read;
          if (!current?.accessToken) {
            return yield* new ShopifyCustomerSessionFailure({
              reason: "unauthenticated",
            });
          }
          const customer = yield* profile(
            Redacted.value(current.accessToken),
            loaded.i18n
          );
          if (customer.id !== current.customer.id) {
            return yield* new ShopifyCustomerSessionFailure({
              reason: "identityMismatch",
            });
          }
          return customer;
        });
        const refresh = (request?: Request) =>
          Effect.gen(function* () {
            const loaded = yield* requireSession;
            const previous = loaded.storage.customer();
            const existingToken = yield* attempt(
              async () =>
                await sdk.getAccessToken(
                  loaded.storage.manager,
                  requestContext(loaded.i18n, request)
                )
            );
            const token = yield* attempt(
              async () =>
                await sdk.getOrRefreshAccessToken(
                  loaded.storage.manager,
                  requestContext(loaded.i18n, request),
                  { origin }
                )
            );
            if (!token) {
              yield* Effect.sync(() => {
                loaded.storage.commit();
              });
              return yield* new ShopifyCustomerSessionFailure({
                reason: "unauthenticated",
              });
            }
            if (previous && token === existingToken) {
              return Redacted.make(token);
            }
            const customer = yield* profile(token, loaded.i18n, request);
            if (previous && previous.id !== customer.id) {
              yield* Effect.sync(() => {
                loaded.storage.clear();
              });
              return yield* new ShopifyCustomerSessionFailure({
                reason: "identityMismatch",
              });
            }
            yield* ensureCustomerIdentity({
              authUserId: loaded.user.id,
              customerId: customer.id,
              mayCreate:
                customer.email.trim().toLowerCase() ===
                loaded.user.email?.trim().toLowerCase(),
            }).pipe(
              Effect.provideService(VersionedKeyValueStore, identityRecords)
            );
            yield* Effect.sync(() => {
              loaded.storage.setCustomer(customer);
              loaded.storage.setCartSynchronizationPending(true);
              loaded.storage.commit();
            });
            return Redacted.make(token);
          });
        const authenticationDestination = (
          returnTo: string,
          purpose: AuthenticationPurpose
        ) =>
          Effect.gen(function* () {
            const loaded = yield* load;
            if (!loaded) {
              return undefined;
            }
            const identity = yield* read;
            if (identity?.accessToken) {
              // A locally unexpired token can have been revoked at Shopify.
              const customer = yield* profile(
                Redacted.value(identity.accessToken),
                loaded.i18n
              );
              if (customer.id !== identity.customer.id) {
                return yield* new ShopifyCustomerSessionFailure({
                  reason: "identityMismatch",
                });
              }
              if (
                purpose === "account" ||
                !identity.cartSynchronizationPending
              ) {
                return undefined;
              }
            }
            return authenticationPath(
              identity ? "refresh" : "login",
              returnTo,
              purpose,
              origin
            );
          });
        return ShopifyCustomerAccounts.of({
          accountDestination: (returnTo) =>
            authenticationDestination(returnTo, "account"),
          checkoutDestination: (returnTo) =>
            authenticationDestination(returnTo, "checkout"),
          cartAccessToken: refresh(),
          completeCartSynchronization: Effect.gen(function* () {
            const loaded = yield* requireSession;
            yield* Effect.sync(() => {
              loaded.storage.setCartSynchronizationPending(false);
              loaded.storage.commit();
            });
          }),
          handle: (request) =>
            Effect.gen(function* () {
              const url = new URL(request.url);
              const returnTo = safeReturnTo(
                url.searchParams.get("return_to"),
                origin
              );
              if (url.pathname === "/account/logout") {
                if (!isSameOriginLogout(request)) {
                  return yield* new ShopifyCustomerSessionFailure({
                    reason: "unauthenticated",
                  });
                }
                const loaded = yield* load;
                const cookies = yield* next.getCookies();
                const destination = loaded?.storage.customer()
                  ? yield* attempt(
                      async () =>
                        await sdk.logout(
                          loaded.storage.manager,
                          requestContext(loaded.i18n, request),
                          {
                            origin,
                            postLogoutRedirectUri: `${origin}${LOGOUT_COMPLETION_PATH}`,
                          }
                        )
                    )
                  : new URL("/", logoutRequestOrigin(request) ?? origin).href;
                yield* Effect.sync(() => {
                  clearShopifyCookies(cookies, request);
                  transientSession(cookies, "recovery").clear();
                  const continuation = transientSession(cookies, "logout");
                  continuation.manager.setSessionItem(
                    "destination",
                    destination
                  );
                  continuation.commit();
                });
                return {
                  destination: LOGOUT_CONTINUATION_PATH,
                  synchronizeCart: false,
                };
              }
              if (url.pathname === LOGOUT_CONTINUATION_PATH) {
                const home = new URL(
                  "/",
                  logoutRequestOrigin(request) ?? origin
                ).href;
                const cookies = yield* next.getCookies();
                const continuation = transientSession(cookies, "logout");
                const destination =
                  continuation.manager.getSessionItem("destination");
                // Consume before leaving the origin. An expired or replayed continuation goes home.
                yield* Effect.sync(() => {
                  continuation.clear();
                });
                const session = yield* auth.read.pipe(
                  Effect.mapError(
                    () =>
                      new ShopifyCustomerSessionFailure({
                        reason: "unavailable",
                      })
                  )
                );
                if (session.user) {
                  return { destination: home, synchronizeCart: false };
                }
                const decoded = Schema.decodeUnknownOption(Schema.String)(
                  destination
                );
                return {
                  destination: Option.getOrElse(decoded, () => home),
                  synchronizeCart: false,
                };
              }
              if (url.pathname === LOGOUT_COMPLETION_PATH) {
                const loaded = yield* load;
                const cookies = yield* next.getCookies();
                const recovery = transientSession(cookies, "recovery");
                const pending = Schema.decodeUnknownOption(
                  Schema.Struct({
                    returnTo: Schema.String,
                    purpose: AuthenticationPurpose,
                    scope: Schema.String,
                    stage: Schema.Literals(["logout", "retry"]),
                  })
                )(recovery.manager.getSessionItem("recovery"));
                if (
                  !loaded ||
                  Option.isNone(pending) ||
                  pending.value.scope !== loaded.scope ||
                  pending.value.stage !== "logout"
                ) {
                  yield* Effect.sync(() => {
                    recovery.clear();
                  });
                  return { destination: `${origin}/`, synchronizeCart: false };
                }
                yield* Effect.sync(() => {
                  recovery.manager.setSessionItem("recovery", {
                    ...pending.value,
                    stage: "retry",
                  });
                  recovery.commit();
                });
                return {
                  destination: authenticationPath(
                    "login",
                    pending.value.returnTo,
                    pending.value.purpose,
                    origin
                  ),
                  synchronizeCart: false,
                };
              }
              const loaded = yield* requireSession;
              const purpose = Option.getOrElse(
                Schema.decodeUnknownOption(AuthenticationPurpose)(
                  url.searchParams.get("purpose")
                ),
                () => "checkout"
              );
              if (url.pathname === "/account/login") {
                const pendingRecovery = transientSession(
                  loaded.cookies,
                  "recovery"
                );
                const recovery = Schema.decodeUnknownOption(
                  Schema.Struct({ scope: Schema.String, stage: Schema.String })
                )(pendingRecovery.manager.getSessionItem("recovery"));
                if (
                  Option.isSome(recovery) &&
                  recovery.value.scope === loaded.scope &&
                  recovery.value.stage === "retry"
                ) {
                  // Persist with the OAuth attempt as well, so a slow login cannot reset the retry bound.
                  loaded.storage.manager.setSessionItem(
                    "identityRecoveryAttempted",
                    true
                  );
                }
                const locale =
                  routing.locales.find(
                    (value) =>
                      returnTo === `/${value}` ||
                      returnTo.startsWith(`/${value}/`)
                  ) ?? (yield* next.getLocale());
                const i18n = contextFor(
                  CommerceLocale.make(locale),
                  loaded.cookies
                );
                const destination = yield* attempt(
                  async () =>
                    await sdk.prepareLoginUrl(
                      loaded.storage.manager,
                      requestContext(i18n, request),
                      {
                        countryCode: i18n.country,
                        locale,
                        loginHint: loaded.user.email ?? undefined,
                        loginHintMode: "submit",
                        origin,
                        returnTo,
                      }
                    )
                );
                yield* Effect.sync(() => {
                  loaded.storage.manager.setSessionItem(
                    "authenticationPurpose",
                    purpose
                  );
                  loaded.storage.commit();
                });
                return { destination, synchronizeCart: false };
              }
              if (url.pathname === "/account/authorize") {
                const loginPurpose = Option.getOrElse(
                  Schema.decodeUnknownOption(AuthenticationPurpose)(
                    loaded.storage.manager.getSessionItem(
                      "authenticationPurpose"
                    )
                  ),
                  () => "checkout"
                );
                const destination = yield* attempt(
                  async () =>
                    await sdk.handleOAuthCallback(
                      loaded.storage.manager,
                      requestContext(loaded.i18n, request),
                      request
                    )
                ).pipe(
                  Effect.tapError(() =>
                    Effect.sync(() => {
                      loaded.storage.clear();
                    })
                  )
                );
                // Shopify verifies the configured IdP. Both sessions must authenticate; email is only an additional mismatch guard.
                const token = yield* attempt(
                  async () =>
                    await sdk.getAccessToken(
                      loaded.storage.manager,
                      requestContext(loaded.i18n, request)
                    )
                );
                if (!token) {
                  return yield* new ShopifyCustomerSessionFailure({
                    reason: "unauthenticated",
                  });
                }
                const customer = yield* profile(token, loaded.i18n, request);
                const recovery = transientSession(loaded.cookies, "recovery");
                const knownRecovery = Schema.decodeUnknownOption(
                  Schema.Struct({ scope: Schema.String, stage: Schema.String })
                )(recovery.manager.getSessionItem("recovery"));
                const mismatch = yield* ensureCustomerIdentity({
                  authUserId: loaded.user.id,
                  customerId: customer.id,
                  mayCreate:
                    customer.email.trim().toLowerCase() ===
                    loaded.user.email?.trim().toLowerCase(),
                }).pipe(
                  Effect.provideService(
                    VersionedKeyValueStore,
                    identityRecords
                  ),
                  Effect.as(false),
                  Effect.catchTag("ShopifyCustomerSessionFailure", (error) =>
                    error.reason === "identityMismatch"
                      ? Effect.succeed(true)
                      : Effect.fail(error)
                  )
                );
                if (mismatch) {
                  if (
                    loaded.storage.manager.getSessionItem(
                      "identityRecoveryAttempted"
                    ) === true ||
                    (Option.isSome(knownRecovery) &&
                      knownRecovery.value.scope === loaded.scope &&
                      knownRecovery.value.stage === "retry")
                  ) {
                    yield* Effect.sync(() => {
                      loaded.storage.clear();
                      recovery.clear();
                    });
                    return yield* new ShopifyCustomerSessionFailure({
                      reason: "identityMismatch",
                    });
                  }
                  const logoutDestination = yield* attempt(
                    async () =>
                      await sdk.logout(
                        loaded.storage.manager,
                        requestContext(loaded.i18n, request),
                        {
                          origin,
                          postLogoutRedirectUri: `${origin}${LOGOUT_COMPLETION_PATH}`,
                        }
                      )
                  );
                  yield* Effect.sync(() => {
                    loaded.storage.clear();
                    recovery.manager.setSessionItem("recovery", {
                      returnTo: safeReturnTo(destination, origin),
                      purpose: loginPurpose,
                      scope: loaded.scope,
                      stage: "logout",
                    });
                    recovery.commit();
                  });
                  return {
                    destination: logoutDestination,
                    synchronizeCart: false,
                  };
                }
                yield* Effect.sync(() => {
                  recovery.clear();
                  loaded.storage.manager.removeSessionItem(
                    "identityRecoveryAttempted"
                  );
                  loaded.storage.manager.removeSessionItem(
                    "authenticationPurpose"
                  );
                  loaded.storage.setCustomer(customer);
                  loaded.storage.setCartSynchronizationPending(true);
                  loaded.storage.commit();
                });
                return {
                  destination: safeReturnTo(destination, origin),
                  synchronizeCart: loginPurpose === "checkout",
                };
              }
              if (url.pathname === "/account/refresh") {
                yield* refresh(request);
                return {
                  destination: returnTo,
                  synchronizeCart: purpose === "checkout",
                };
              }
              return yield* new ShopifyCustomerSessionFailure({
                reason: "unauthenticated",
              });
            }),
          profile: readProfile,
          read,
          refreshProfile: Effect.gen(function* () {
            yield* refresh();
            const loaded = yield* requireSession;
            const customer = yield* readProfile;
            yield* ensureCustomerIdentity({
              authUserId: loaded.user.id,
              customerId: customer.id,
              mayCreate:
                customer.email.trim().toLowerCase() ===
                loaded.user.email?.trim().toLowerCase(),
            }).pipe(
              Effect.provideService(VersionedKeyValueStore, identityRecords)
            );
            yield* Effect.sync(() => {
              loaded.storage.setCustomer(customer);
              loaded.storage.commit();
            });
            return customer;
          }),
        });
      })
    ).pipe(Layer.provide(identityStoreLayer));
  static readonly layer = Layer.unwrap(
    Effect.sync(() =>
      ShopifyCustomerAccounts.layerWith({ environment: customerAccountKeys() })
    )
  );
}
