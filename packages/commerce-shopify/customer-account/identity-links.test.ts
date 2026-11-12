import { describe, expect, it } from "@effect/vitest";
import { AuthUserId } from "@repo/auth-contract/access-token";
import { VersionedKeyValueStore } from "@repo/versioned-store";
import { Effect } from "effect";

import { ShopifyCompanyAdmin } from "../company/admin";
import {
  claimIdentity,
  ensureCustomerIdentity,
  findCustomerByIdentitySubject,
  findLinkedCustomerId,
  identityKey,
  IdentityLink,
} from "./identity-links";

const identity = { authUserId: "user-1", customerId: "customer-1" };
describe("Shopify customer identity association", () => {
  it.effect("uses the Shopify-recorded provider and subject as proof", () =>
    Effect.gen(function* () {
      const lookup = {
        authUserId: AuthUserId.make(identity.authUserId),
        email: "buyer@example.test",
        providerName: "Storefront sign-in",
      };
      expect(yield* findCustomerByIdentitySubject(lookup)).toBe(
        identity.customerId
      );
      expect(
        yield* findCustomerByIdentitySubject({
          ...lookup,
          authUserId: AuthUserId.make("other-user"),
        })
      ).toBeUndefined();
      expect(
        yield* findCustomerByIdentitySubject({
          ...lookup,
          providerName: "Other provider",
        })
      ).toBeUndefined();
      yield* claimIdentity({ ...identity, authUserId: "other-user" });
      const failure = yield* findCustomerByIdentitySubject(lookup).pipe(
        Effect.flip
      );
      expect(failure).toMatchObject({ reason: "identityMismatch" });
    }).pipe(
      Effect.provide(VersionedKeyValueStore.layerMemory),
      Effect.provideService(
        ShopifyCompanyAdmin,
        ShopifyCompanyAdmin.of({
          request: () =>
            Effect.succeed({
              customerByIdentifier: {
                id: identity.customerId,
                identityProviderSubjects: [
                  {
                    providerName: "Storefront sign-in",
                    subject: identity.authUserId,
                  },
                ],
              },
            }),
        })
      )
    )
  );

  it.effect("resolves the linked customer only for the exact site user", () =>
    Effect.gen(function* () {
      yield* claimIdentity(identity);
      expect(
        yield* findLinkedCustomerId(AuthUserId.make(identity.authUserId))
      ).toBe(identity.customerId);
      expect(
        yield* findLinkedCustomerId(AuthUserId.make("other-user"))
      ).toBeUndefined();
    }).pipe(Effect.provide(VersionedKeyValueStore.layerMemory))
  );

  it.effect("rejects a stored link for a different site user", () =>
    Effect.gen(function* () {
      const store = yield* VersionedKeyValueStore;
      const wrongUserId = AuthUserId.make("other-user");
      yield* store.insert(
        identityKey("auth", wrongUserId),
        IdentityLink,
        identity
      );
      const failure = yield* findLinkedCustomerId(wrongUserId).pipe(
        Effect.flip
      );
      expect(failure.reason).toBe("identityMismatch");
    }).pipe(Effect.provide(VersionedKeyValueStore.layerMemory))
  );

  it.effect(
    "preserves an established association independently of email eligibility",
    () =>
      Effect.gen(function* () {
        yield* ensureCustomerIdentity({ ...identity, mayCreate: true });
        yield* ensureCustomerIdentity({ ...identity, mayCreate: false });
        const error = yield* ensureCustomerIdentity({
          ...identity,
          customerId: "customer-2",
          mayCreate: true,
        }).pipe(Effect.flip);
        expect(error.reason).toBe("identityMismatch");
      }).pipe(Effect.provide(VersionedKeyValueStore.layerMemory))
  );
  it.effect(
    "rejects claiming a customer already associated with another site user",
    () =>
      Effect.gen(function* () {
        yield* claimIdentity(identity);
        const error = yield* ensureCustomerIdentity({
          ...identity,
          authUserId: "user-2",
          mayCreate: true,
        }).pipe(Effect.flip);
        expect(error.reason).toBe("identityMismatch");
      }).pipe(Effect.provide(VersionedKeyValueStore.layerMemory))
  );
  it.effect("requires first-connection proof when no association exists", () =>
    Effect.gen(function* () {
      const error = yield* ensureCustomerIdentity({
        ...identity,
        mayCreate: false,
      }).pipe(Effect.flip);
      expect(error.reason).toBe("identityMismatch");
      yield* ensureCustomerIdentity({ ...identity, mayCreate: true });
      yield* ensureCustomerIdentity({ ...identity, mayCreate: false });
    }).pipe(Effect.provide(VersionedKeyValueStore.layerMemory))
  );
});
