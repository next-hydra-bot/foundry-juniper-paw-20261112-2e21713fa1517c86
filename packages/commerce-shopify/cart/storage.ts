import { createHash } from "node:crypto";

import "server-only";
import {
  CartAccessDenied,
  CartLineItemNotFound,
  cartMutationRejected,
  CartProviderFailure,
  CartWriteOutcomeUnknown,
  CurrentCartUnavailable,
} from "@repo/commerce-core/domain/cart-errors";
import type { CartOperation } from "@repo/commerce-core/domain/cart-errors";
import { CommerceContext } from "@repo/commerce-core/services/commerce-context";
import { CurrentCartStorage } from "@repo/commerce-core/services/current-cart-storage";
import { Context, Effect, Layer, Option, Ref, Schema } from "effect";

import type { ShopifyRequestFailure } from "../client/storefront";
import { ShopifyStorefrontClient } from "../client/storefront";
import { storefrontContext } from "../store";
import {
  ShopifyStoreAttribution,
  storeAttributionMetafield,
} from "../store-attribution";
import {
  cartQuery,
  createCartMutation,
  addLinesMutation,
  updateLinesMutation,
  removeLinesMutation,
  updateBuyerMutation,
  setStoreAttributionMutation,
  updateDiscountCodesMutation,
} from "./graphql";
import { mapCart } from "./mapping";
import { ShopifyCartPersistence } from "./persistence";
import { CartResponse, MutationResult } from "./schema";
import type { ShopifyCart } from "./schema";
import { CART_COOKIE_NAME, ShopifyCartSession } from "./session";

const readFailure =
  (operation: CartOperation) => (failure: ShopifyRequestFailure) =>
    new CartProviderFailure({
      operation,
      reason:
        failure.reason === "unavailable" ? "unavailable" : "unexpectedResponse",
    });

export interface ShopifyCartBuyer {
  readonly customerId?: string;
  readonly companyLocationId?: string;
  readonly scope?: string;
  readonly accessToken: Effect.Effect<string | undefined, CartProviderFailure>;
  readonly synchronizationPending?: boolean;
  readonly tokenFingerprint?: string;
  readonly completeSynchronization?: Effect.Effect<void, CartProviderFailure>;
}

export const cartStorageLayerWith = <R>(
  buyerEffect: Effect.Effect<ShopifyCartBuyer, never, R>
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const context = yield* CommerceContext;
      const { principal, store } = context;
      const buyer = yield* buyerEffect;
      const customerId =
        principal._tag === "AnonymousCommercePrincipal"
          ? undefined
          : principal.customerId;
      if (
        (principal._tag === "CustomerCommercePrincipal"
          ? principal.businessUnitId
          : undefined) !== buyer.companyLocationId ||
        customerId !== buyer.customerId
      ) {
        return yield* Effect.die(
          "Shopify authenticated cart context is not configured"
        );
      }
      const client = yield* ShopifyStorefrontClient;
      const execute = <A>(
        request: Effect.Effect<A, ShopifyRequestFailure, CommerceContext>
      ) => request.pipe(Effect.provideService(CommerceContext, context));
      const persistence = yield* ShopifyCartPersistence;
      const cookieName = buyer.companyLocationId
        ? `${CART_COOKIE_NAME}.${createHash("sha256")
            .update(
              JSON.stringify([
                buyer.customerId,
                buyer.companyLocationId,
                store.storeKey,
                store.locale,
              ])
            )
            .digest("hex")
            .slice(0, 20)}`
        : CART_COOKIE_NAME;
      const cookie = yield* persistence.read(cookieName);
      const initialId =
        Option.isSome(cookie) &&
        cookie.value.shop === client.storeDomain &&
        cookie.value.storeKey === store.storeKey &&
        cookie.value.locale === store.locale &&
        cookie.value.companyLocationId === buyer.companyLocationId &&
        (cookie.value.buyer === buyer.scope ||
          (cookie.value.buyer === undefined &&
            buyer.scope !== undefined &&
            buyer.companyLocationId === undefined))
          ? cookie.value.id
          : undefined;
      const credential = yield* Ref.make(initialId);
      const synchronizationPending = yield* Ref.make(
        (buyer.synchronizationPending ?? false) ||
          (buyer.tokenFingerprint !== undefined &&
            initialId !== undefined &&
            Option.isSome(cookie) &&
            cookie.value.tokenFingerprint !== buyer.tokenFingerprint)
      );
      const { country } = storefrontContext(store);

      const readPage = (id: string, after: string | null = null) =>
        client
          .execute(
            async (sdk, signal) =>
              await sdk.graphql(cartQuery, {
                signal,
                variables: { after, id },
              })
          )
          .pipe(
            execute,
            Effect.mapError(readFailure("findById")),
            Effect.flatMap((data) =>
              Schema.decodeUnknownEffect(CartResponse)(data).pipe(
                Effect.mapError(
                  () =>
                    new CartProviderFailure({
                      operation: "findById",
                      reason: "invalidData",
                    })
                )
              )
            )
          );
      const complete = (cart: ShopifyCart) =>
        Effect.gen(function* () {
          const nodes = [...cart.lines.nodes];
          let page = cart.lines.pageInfo;
          const cursors = new Set<string>();
          while (page.hasNextPage) {
            if (!page.endCursor || cursors.has(page.endCursor)) {
              return yield* new CartProviderFailure({
                operation: "findById",
                reason: "invalidData",
              });
            }
            cursors.add(page.endCursor);
            const next = yield* readPage(cart.id, page.endCursor);
            if (!next.cart) {
              return yield* new CartProviderFailure({
                operation: "findById",
                reason: "unexpectedResponse",
              });
            }
            nodes.push(...next.cart.lines.nodes);
            page = next.cart.lines.pageInfo;
          }
          return { ...cart, lines: { nodes, pageInfo: page } };
        });
      const read = () =>
        Effect.gen(function* () {
          const id = yield* Ref.get(credential);
          if (!id) {
            return Option.none<ShopifyCart>();
          }
          const response = yield* readPage(id);
          return response.cart
            ? Option.some(yield* complete(response.cart))
            : Option.none<ShopifyCart>();
        }).pipe(
          Effect.catchTag("CartProviderFailure", (error) =>
            error.reason === "unavailable"
              ? Effect.fail(error)
              : Effect.die(error)
          )
        );
      const mutate = (
        operation: CartOperation,
        request: Effect.Effect<unknown, ShopifyRequestFailure, CommerceContext>
      ) =>
        Effect.gen(function* () {
          const result = yield* request.pipe(
            execute,
            Effect.mapError(() => new CartWriteOutcomeUnknown({ operation })),
            Effect.flatMap((data) =>
              Schema.decodeUnknownEffect(MutationResult)(data).pipe(
                Effect.mapError(
                  () => new CartWriteOutcomeUnknown({ operation })
                )
              )
            )
          );
          if (result.userErrors.length) {
            return yield* Effect.fail(
              cartMutationRejected({
                message:
                  operation === "changeDiscountCode"
                    ? "The discount code could not be applied to this cart."
                    : "The cart change was rejected. Check the selected items and quantities.",
                operation,
              })
            );
          }
          if (!result.cart) {
            return yield* new CartWriteOutcomeUnknown({ operation });
          }
          // Follow-up reads never replay the mutation when the resulting state cannot be confirmed.
          return yield* complete(result.cart).pipe(
            Effect.mapError(() => new CartWriteOutcomeUnknown({ operation }))
          );
        });
      const requireCredential = () =>
        Ref.get(credential).pipe(
          Effect.flatMap((id) =>
            id
              ? Effect.succeed(id)
              : new CurrentCartUnavailable({ reason: "noCart" })
          )
        );
      const attributeCreatedCart = (
        cart: ShopifyCart,
        operation: CartOperation
      ) =>
        Effect.gen(function* () {
          // Never relabel a Cart already attributed to another Store.
          if (
            cart.storeAttribution !== null &&
            cart.storeAttribution.value !== store.storeKey
          ) {
            return yield* new CartWriteOutcomeUnknown({ operation });
          }
          const data = yield* client
            .execute(
              async (sdk, signal) =>
                await sdk.graphql(setStoreAttributionMutation, {
                  signal,
                  variables: {
                    metafields: [
                      {
                        key: `${storeAttributionMetafield.namespace}.${storeAttributionMetafield.key}`,
                        ownerId: cart.id,
                        type: storeAttributionMetafield.type,
                        value: store.storeKey,
                      },
                    ],
                  },
                })
            )
            .pipe(
              execute,
              Effect.mapError(() => new CartWriteOutcomeUnknown({ operation }))
            );
          const result = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              metafields: Schema.Array(
                Schema.Struct({
                  ...ShopifyStoreAttribution.fields,
                  key: Schema.Literal(storeAttributionMetafield.key),
                  namespace: Schema.Literal(
                    storeAttributionMetafield.namespace
                  ),
                })
              ),
              userErrors: Schema.Array(
                Schema.Struct({ message: Schema.String })
              ),
            })
          )(data.cartMetafieldsSet).pipe(
            Effect.mapError(() => new CartWriteOutcomeUnknown({ operation }))
          );
          const [attribution] = result.metafields;
          if (
            result.userErrors.length > 0 ||
            result.metafields.length !== 1 ||
            attribution?.value !== store.storeKey
          ) {
            return yield* new CartWriteOutcomeUnknown({ operation });
          }
          return { ...cart, storeAttribution: attribution };
        });
      const checkTarget = (id: string) =>
        Effect.gen(function* () {
          const cart = yield* read();
          if (Option.isNone(cart)) {
            return yield* new CartAccessDenied({ operation: "findById" });
          }
          const mapped = mapCart(
            cart.value,
            store,
            buyer.customerId,
            buyer.companyLocationId
          );
          if (mapped.id !== id) {
            return yield* new CartAccessDenied({ operation: "findById" });
          }
          return mapped;
        });
      const mapWrittenCart = (cart: ShopifyCart, operation: CartOperation) =>
        Effect.try({
          catch: () => new CartWriteOutcomeUnknown({ operation }),
          try: () =>
            mapCart(cart, store, buyer.customerId, buyer.companyLocationId),
        });
      const persist = (id: string) =>
        persistence.write(cookieName, {
          buyer: buyer.scope,
          companyLocationId: buyer.companyLocationId,
          id,
          locale: store.locale,
          shop: client.storeDomain,
          storeKey: store.storeKey,
          tokenFingerprint: buyer.tokenFingerprint,
        });
      const completeSynchronization = () =>
        Effect.gen(function* () {
          yield* buyer.completeSynchronization ?? Effect.void;
          yield* Ref.set(synchronizationPending, false);
        });
      const synchronizeBuyer = () =>
        Effect.gen(function* () {
          if (!buyer.customerId) {
            return;
          }
          const existing = yield* read();
          if (Option.isNone(existing)) {
            yield* completeSynchronization();
            return;
          }
          const remoteCustomer = existing.value.buyerIdentity.customer?.id;
          const remoteCompany =
            existing.value.buyerIdentity.purchasingCompany?.location.id;
          if (
            existing.value.storeAttribution?.value !== store.storeKey ||
            (remoteCustomer && remoteCustomer !== buyer.customerId) ||
            (remoteCompany !== undefined &&
              remoteCompany !== buyer.companyLocationId) ||
            existing.value.buyerIdentity.countryCode !== country
          ) {
            return yield* new CartProviderFailure({
              operation: "findById",
              reason: "unexpectedResponse",
            });
          }
          const token = yield* buyer.accessToken;
          const updated = yield* mutate(
            "findById",
            client
              .execute(
                async (sdk, signal) =>
                  await sdk.graphql(updateBuyerMutation, {
                    signal,
                    variables: {
                      after: null,
                      buyerIdentity: {
                        companyLocationId: buyer.companyLocationId,
                        countryCode: country,
                        customerAccessToken: token,
                      },
                      id: existing.value.id,
                    },
                  })
              )
              .pipe(Effect.map((data) => data.cartBuyerIdentityUpdate))
          ).pipe(
            Effect.mapError(
              () =>
                new CartProviderFailure({
                  operation: "findById",
                  reason: "unavailable",
                })
            )
          );
          yield* Effect.sync(() =>
            mapCart(updated, store, buyer.customerId, buyer.companyLocationId)
          );
          yield* persist(updated.id);
          yield* Ref.set(credential, updated.id);
          yield* completeSynchronization();
        });
      const synchronizeIfPending = () =>
        Ref.get(synchronizationPending).pipe(
          Effect.flatMap((pending) =>
            pending ? synchronizeBuyer() : Effect.void
          )
        );
      const storage = CurrentCartStorage.of({
        addItem: (input) =>
          Effect.gen(function* () {
            yield* synchronizeIfPending();
            yield* checkTarget(input.target.id);
            const id = yield* requireCredential().pipe(Effect.orDie);
            const cart = yield* mutate(
              "addItem",
              client
                .execute(
                  async (sdk, signal) =>
                    await sdk.graphql(addLinesMutation, {
                      signal,
                      variables: {
                        after: null,
                        id,
                        lines: [
                          {
                            merchandiseId: input.variantId,
                            quantity: input.quantity,
                          },
                        ],
                      },
                    })
                )
                .pipe(Effect.map((data) => data.cartLinesAdd))
            );
            return yield* mapWrittenCart(cart, "addItem");
          }),
        changeDiscountCode: (input) =>
          Effect.gen(function* () {
            yield* synchronizeIfPending();
            const current = yield* checkTarget(input.target.id);
            const codes = current.discountCodes?.map(({ code }) => code) ?? [];
            const sameCode = (code: string) =>
              code.toLowerCase() === input.code.toLowerCase();
            let selected = codes.filter((code) => !sameCode(code));
            if (input.action === "add") {
              selected = codes.some(sameCode) ? codes : [...codes, input.code];
            }
            const id = yield* requireCredential().pipe(Effect.orDie);
            return yield* mapWrittenCart(
              yield* mutate(
                "changeDiscountCode",
                client
                  .execute(
                    async (sdk, signal) =>
                      await sdk.graphql(updateDiscountCodesMutation, {
                        signal,
                        variables: { after: null, codes: selected, id },
                      })
                  )
                  .pipe(Effect.map((data) => data.cartDiscountCodesUpdate))
              ),
              "changeDiscountCode"
            );
          }),
        create: () =>
          Effect.gen(function* () {
            const customerAccessToken = yield* buyer.accessToken;
            const createOperation = buyer.customerId
              ? "createForCustomer"
              : "createAnonymous";
            const created = yield* mutate(
              createOperation,
              client
                .execute(
                  async (sdk, signal) =>
                    await sdk.graphql(createCartMutation, {
                      signal,
                      variables: {
                        after: null,
                        input: {
                          buyerIdentity: {
                            companyLocationId: buyer.companyLocationId,
                            countryCode: country,
                            customerAccessToken,
                          },
                        },
                      },
                    })
                )
                .pipe(Effect.map((data) => data.cartCreate))
            );
            const cart = yield* attributeCreatedCart(created, createOperation);
            const snapshot = yield* mapWrittenCart(cart, createOperation);
            yield* persist(cart.id);
            yield* Ref.set(credential, cart.id);
            yield* completeSynchronization();
            return snapshot;
          }),
        forget: () =>
          persistence
            .clear(cookieName)
            .pipe(Effect.andThen(Ref.set(credential, undefined))),
        removeLineItem: (input) =>
          Effect.gen(function* () {
            yield* synchronizeIfPending();
            const current = yield* checkTarget(input.target.id);
            if (
              !current.lineItems.some((line) => line.id === input.lineItemId)
            ) {
              return yield* new CartLineItemNotFound({
                cartId: current.id,
                lineItemId: input.lineItemId,
                operation: "removeLineItem",
              });
            }
            const id = yield* requireCredential().pipe(Effect.orDie);
            return yield* mapWrittenCart(
              yield* mutate(
                "removeLineItem",
                client
                  .execute(
                    async (sdk, signal) =>
                      await sdk.graphql(removeLinesMutation, {
                        signal,
                        variables: {
                          after: null,
                          id,
                          lineIds: [input.lineItemId],
                        },
                      })
                  )
                  .pipe(Effect.map((data) => data.cartLinesRemove))
              ),
              "removeLineItem"
            );
          }),
        resolve: () =>
          read().pipe(
            Effect.flatMap((cart) =>
              Ref.get(synchronizationPending).pipe(
                Effect.map((pending) =>
                  cart.pipe(
                    Option.map((snapshot) =>
                      mapCart(
                        snapshot,
                        store,
                        pending && snapshot.buyerIdentity.customer === null
                          ? undefined
                          : buyer.customerId,
                        buyer.companyLocationId
                      )
                    )
                  )
                )
              )
            )
          ),
        setLineItemQuantity: (input) =>
          Effect.gen(function* () {
            yield* synchronizeIfPending();
            const current = yield* checkTarget(input.target.id);
            if (
              !current.lineItems.some((line) => line.id === input.lineItemId)
            ) {
              return yield* new CartLineItemNotFound({
                cartId: current.id,
                lineItemId: input.lineItemId,
                operation: "setLineItemQuantity",
              });
            }
            const id = yield* requireCredential().pipe(Effect.orDie);
            return yield* mapWrittenCart(
              yield* mutate(
                "setLineItemQuantity",
                client
                  .execute(
                    async (sdk, signal) =>
                      await sdk.graphql(updateLinesMutation, {
                        signal,
                        variables: {
                          after: null,
                          id,
                          lines: [
                            { id: input.lineItemId, quantity: input.quantity },
                          ],
                        },
                      })
                  )
                  .pipe(Effect.map((data) => data.cartLinesUpdate))
              ),
              "setLineItemQuantity"
            );
          }),
      });
      const session = ShopifyCartSession.of({
        buyerSynchronizationPending: Ref.get(synchronizationPending),
        detachBuyer: () =>
          Effect.gen(function* () {
            if (!buyer.customerId) {
              return;
            }
            const current = yield* read();
            if (Option.isNone(current)) {
              return;
            }
            // Verify the selected cart before removing its customer and company authority.
            yield* Effect.sync(() =>
              mapCart(
                current.value,
                store,
                buyer.customerId,
                buyer.companyLocationId
              )
            );
            const updated = yield* mutate(
              "findById",
              client
                .execute(
                  async (sdk, signal) =>
                    await sdk.graphql(updateBuyerMutation, {
                      signal,
                      variables: {
                        after: null,
                        buyerIdentity: {
                          companyLocationId: null,
                          customerAccessToken: null,
                          email: null,
                          phone: null,
                        },
                        id: current.value.id,
                      },
                    })
                )
                .pipe(Effect.map((data) => data.cartBuyerIdentityUpdate))
            ).pipe(
              Effect.mapError(
                () =>
                  new CartProviderFailure({
                    operation: "findById",
                    reason: "unavailable",
                  })
              )
            );
            if (
              updated.buyerIdentity.customer ||
              updated.buyerIdentity.purchasingCompany
            ) {
              return yield* new CartProviderFailure({
                operation: "findById",
                reason: "unexpectedResponse",
              });
            }
          }).pipe(Effect.ensuring(persistence.clear(cookieName))),
        readCheckout: () =>
          Ref.get(synchronizationPending).pipe(
            Effect.flatMap((pending) =>
              pending
                ? new CartProviderFailure({
                    operation: "findById",
                    reason: "unavailable",
                  })
                : read()
            ),
            Effect.flatMap(
              Option.match({
                onNone: () => new CurrentCartUnavailable({ reason: "noCart" }),
                onSome: (cart) =>
                  Effect.sync(() => {
                    const snapshot = mapCart(
                      cart,
                      store,
                      buyer.customerId,
                      buyer.companyLocationId
                    );
                    const url = new URL(cart.checkoutUrl);
                    if (
                      url.protocol !== "https:" ||
                      url.username ||
                      url.password
                    ) {
                      throw new Error(
                        "Shopify returned an invalid checkout destination"
                      );
                    }
                    const checkoutUrl: `https://${string}` = `https://${url.host}${url.pathname}${url.search}${url.hash}`;
                    return { cart: snapshot, checkoutUrl };
                  }),
              })
            )
          ),
        synchronizeBuyer,
      });
      return Context.make(CurrentCartStorage, storage).pipe(
        Context.add(ShopifyCartSession, session)
      );
    })
  );
