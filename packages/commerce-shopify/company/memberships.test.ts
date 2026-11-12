import { describe, expect, it } from "@effect/vitest";
import {
  CommerceBusinessUnitId,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/commerce-account";
import { CommerceCompanyMemberships } from "@repo/commerce-core/services/commerce-company-memberships";
import { Effect, Layer } from "effect";

import {
  fixture,
  bindings,
  companyId,
  locationId,
  buyerRoleId,
} from "../testing/company-admin";
import { companyMembershipsLayerWith } from "./memberships";
const roles = { adminRoleIds: ["gid://shopify/CompanyContactRole/2"] as const };
describe("Shopify company memberships", () => {
  it.effect(
    "lists native members without requiring application identities and removes only the selected location",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const other = CommerceBusinessUnitId.make(
          "gid://shopify/CompanyLocation/2"
        );
        source.customers.set("admin@example.com", {
          contact: {
            companyId,
            id: "gid://shopify/CompanyContact/1",
            roles: new Map([[locationId, roles.adminRoleIds[0]]]),
          },
          email: "admin@example.com",
          id: "gid://shopify/Customer/1",
        });
        source.customers.set("buyer@example.com", {
          contact: {
            companyId,
            id: "gid://shopify/CompanyContact/2",
            roles: new Map([
              [locationId, buyerRoleId],
              [other, buyerRoleId],
            ]),
          },
          email: "buyer@example.com",
          id: "gid://shopify/Customer/2",
        });
        const layer = companyMembershipsLayerWith(bindings).pipe(
          Layer.provide(source.store),
          Layer.provide(source.admin)
        );
        yield* Effect.gen(function* () {
          const members = yield* CommerceCompanyMemberships;
          const roster = yield* members.getRoster(locationId);
          expect(
            roster.members.map((member) => ({
              authUserId: member.authUserId,
              canRemove: member.canRemove,
            }))
          ).toEqual([
            { authUserId: undefined, canRemove: false },
            { authUserId: undefined, canRemove: true },
          ]);
          const removal = yield* members.removeMember({
            businessUnitId: locationId,
            customerId: CommerceCustomerId.make("gid://shopify/Customer/2"),
            expectedRevision: roster.revision,
          });
          expect(removal).toMatchObject({
            customerDisposition: "retained",
            remainingMembership: { businessUnitId: other },
          });
          expect(
            source.customers
              .get("buyer@example.com")
              ?.contact?.roles.has(locationId)
          ).toBeFalsy();
          expect(source.customers.size).toBe(2);
        }).pipe(Effect.provide(layer));
      })
  );
  it.effect(
    "rejects stale rosters and reconciles a committed removal after a lost response",
    () =>
      Effect.gen(function* () {
        const source = fixture();
        const customerId = CommerceCustomerId.make("gid://shopify/Customer/2");
        const customer = {
          contact: {
            companyId,
            id: "gid://shopify/CompanyContact/2",
            roles: new Map([[locationId, buyerRoleId]]),
          },
          email: "buyer@example.com",
          id: customerId,
        };
        source.customers.set(customer.email, customer);
        const layer = companyMembershipsLayerWith(bindings).pipe(
          Layer.provide(source.store),
          Layer.provide(source.admin)
        );
        yield* Effect.gen(function* () {
          const members = yield* CommerceCompanyMemberships;
          const roster = yield* members.getRoster(locationId);
          customer.contact.roles.set(locationId, roles.adminRoleIds[0]);
          const stale = yield* members
            .removeMember({
              businessUnitId: locationId,
              customerId,
              expectedRevision: roster.revision,
            })
            .pipe(Effect.flip);
          expect(stale._tag).toBe("CommerceCompanyMembershipChanged");
          customer.contact.roles.set(locationId, buyerRoleId);
          source.loseRevocation();
          const failure = yield* members
            .removeMember({
              businessUnitId: locationId,
              customerId,
              expectedRevision: roster.revision,
            })
            .pipe(Effect.flip);
          expect(failure._tag).toBe("CommerceAccountUnavailable");
          expect(source.writes).toEqual(["revoke"]);
        }).pipe(Effect.provide(layer));
      })
  );
});
