import { describe, expect, it } from "@effect/vitest";
import { CompanyMemberProvisioning } from "@repo/commerce-core/services/company-member-provisioning";
import {
  VersionedKeyValueStore,
  VersionedStoreKey,
} from "@repo/versioned-store";
import { Effect, Option, Schema } from "effect";

import {
  fixture,
  input,
  locationId,
  buyerRoleId,
} from "../testing/company-admin";

describe("Shopify company invitations", () => {
  it.effect(
    "creates a customer, contact and buyer assignment once across acceptance retries",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const run = CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) => members.addMember(input))
        );
        const first = yield* run.pipe(Effect.provide(source.layer));
        const second = yield* run.pipe(Effect.provide(source.layer));
        expect(second).toEqual(first);
        expect(source.writes).toEqual(["create", "assign"]);
        expect(
          source.namespaces.every(
            (namespace) => namespace === "$app:company_identities"
          )
        ).toBeTruthy();
        expect(
          source.customers
            .get("buyer@example.com")
            ?.contact?.roles.get(locationId)
        ).toBe(buyerRoleId);
      })
  );
  it.effect(
    "links an existing SSO customer and reconciles a lost assignment response",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        source.customers.set("buyer@example.com", {
          email: "buyer@example.com",
          id: "gid://shopify/Customer/9",
        });
        source.loseAssignment();
        const run = CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) => members.addMember(input))
        );
        expect(
          (yield* run.pipe(Effect.exit, Effect.provide(source.layer)))._tag
        ).toBe("Failure");
        const recovered = yield* run.pipe(Effect.provide(source.layer));
        expect(recovered.customerId).toBe("gid://shopify/Customer/9");
        expect(source.writes).toEqual(["link", "assign"]);
      })
  );
  it.effect(
    "rejects another company, another auth identity and unsupported offered roles",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        source.customers.set("buyer@example.com", {
          contact: {
            companyId: "gid://shopify/Company/2",
            id: "other",
            roles: new Map(),
          },
          email: "buyer@example.com",
          id: "gid://shopify/Customer/9",
        });
        const available = yield* CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) =>
            members.canAddMember({
              businessUnitId: locationId,
              email: input.acceptedIdentity.email,
            })
          ),
          Effect.provide(source.layer)
        );
        expect(available).toBeFalsy();
        const foreign = yield* CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) => members.addMember(input)),
          Effect.exit,
          Effect.provide(source.layer)
        );
        expect(foreign._tag).toBe("Failure");
        expect(source.writes).toEqual([]);
        source.customers.clear();
        yield* CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) => members.addMember(input)),
          Effect.provide(source.layer)
        );
        const otherIdentity = yield* CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) =>
            members.addMember({
              ...input,
              acceptedIdentity: {
                ...input.acceptedIdentity,
                authUserId: "other-user",
              },
            })
          ),
          Effect.exit,
          Effect.provide(source.layer)
        );
        const admin = yield* CompanyMemberProvisioning.pipe(
          Effect.flatMap((members) =>
            members.addMember({ ...input, roles: ["admin"] })
          ),
          Effect.exit,
          Effect.provide(source.layer)
        );
        expect([otherIdentity._tag, admin._tag]).toEqual([
          "Failure",
          "Failure",
        ]);
        expect(source.writes).toEqual(["create", "assign"]);
      })
  );
  it.effect(
    "uses compare-and-set for records, including deletion and reinsertion",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        yield* Effect.gen(function* () {
          const store = yield* VersionedKeyValueStore;
          const key = VersionedStoreKey.make("invitation-1");
          yield* store.insert(key, Schema.String, "pending");
          const initial = yield* store.get(key, Schema.String);
          if (Option.isNone(initial)) {
            return yield* Effect.die("Missing fixture record");
          }
          yield* store.update(key, Schema.String, initial.value, "accepted");
          const stale = yield* store
            .update(key, Schema.String, initial.value, "revoked")
            .pipe(Effect.flip);
          expect(stale._tag).toBe("StoreConflict");
          const accepted = yield* store.get(key, Schema.String);
          if (Option.isNone(accepted)) {
            return yield* Effect.die("Missing fixture record");
          }
          yield* store.update(key, Schema.String, accepted.value, "pending");
          const reusedValue = yield* store
            .update(key, Schema.String, initial.value, "revoked")
            .pipe(Effect.flip);
          expect(reusedValue._tag).toBe("StoreConflict");
          const current = yield* store.get(key, Schema.String);
          if (Option.isNone(current)) {
            return yield* Effect.die("Missing fixture record");
          }
          yield* store.remove(key, current.value);
          expect(
            Option.isNone(yield* store.get(key, Schema.String))
          ).toBeTruthy();
          yield* store.insert(key, Schema.String, "replacement");
          expect(
            (yield* store.values(Schema.String)).map(({ value }) => value)
          ).toEqual(["replacement"]);
        }).pipe(Effect.provide(source.store));
      })
  );
});
