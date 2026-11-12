import { Effect, Layer } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { AuthUserId } from "./access-token";
import {
  PermissionCheckFailure,
  Permissions,
  defineAuthorization,
} from "./permissions";
import type { PermissionContext } from "./permissions";

const company = ["company.members.invite", "company.members.remove"] as const;
const customer = ["customer.profile.update"] as const;
const context: PermissionContext = {
  authUserId: AuthUserId.make("alice"),
  scope: { id: "warehouse-east", type: "business-unit" },
};

describe("typed authorization", () => {
  it("infers the union from all installed feature definitions", () => {
    const authorization = defineAuthorization(company, customer);
    expectTypeOf(authorization.has)
      .parameter(0)
      .toEqualTypeOf<
        | "company.members.invite"
        | "company.members.remove"
        | "customer.profile.update"
      >();
    expectTypeOf(authorization.permissions).toEqualTypeOf<
      readonly (
        | "company.members.invite"
        | "company.members.remove"
        | "customer.profile.update"
      )[]
    >();
    expectTypeOf(authorization.has("company.members.invite")).toEqualTypeOf<
      Effect.Effect<boolean, PermissionCheckFailure, Permissions>
    >();
  });

  it("has no accepted permission names for an empty manifest", () => {
    const authorization = defineAuthorization();
    expectTypeOf(authorization.has).parameter(0).toEqualTypeOf<never>();
    expect(authorization.permissions).toEqual([]);
  });

  it("keeps customer and Admin vocabularies separate", async () => {
    const storefront = defineAuthorization(customer);
    const admin = defineAuthorization([
      "registration.read",
      "registration.decide",
    ]);
    expectTypeOf(storefront.has)
      .parameter(0)
      .toEqualTypeOf<"customer.profile.update">();
    expectTypeOf(admin.has)
      .parameter(0)
      .toEqualTypeOf<"registration.read" | "registration.decide">();
    // @ts-expect-error Admin permission names are not storefront permission names.
    const invalidStorefront = storefront.has("registration.decide");
    // @ts-expect-error Storefront permissions cannot be used through the Admin manifest.
    const invalidAdmin = admin.has("customer.profile.update");
    await expect(
      Effect.runPromise(
        invalidStorefront.pipe(Effect.provide(Permissions.layerNone))
      )
    ).resolves.toBeFalsy();
    await expect(
      Effect.runPromise(
        invalidAdmin.pipe(Effect.provide(Permissions.layerNone))
      )
    ).resolves.toBeFalsy();
  });

  it("deduplicates definitions and snapshots them without granting authority", async () => {
    const definitions: "company.members.invite"[] = ["company.members.invite"];
    const authorization = defineAuthorization(definitions, company);
    definitions.length = 0;
    expect(authorization.permissions).toEqual(company);
    await expect(
      Effect.runPromise(
        authorization
          .has("company.members.invite")
          .pipe(Effect.provide(Permissions.layerNone))
      )
    ).resolves.toBeFalsy();
  });

  it("delegates lazily to the request's user and scope", async () => {
    const checks: { context: PermissionContext; permission: string }[] = [];
    const authorization = defineAuthorization(company);
    const effect = authorization.has("company.members.invite");
    const layer = Permissions.layerWith(context, {
      has: (current, permission) =>
        Effect.sync(() => {
          checks.push({ context: current, permission });
          return true;
        }),
    });
    expect(checks).toEqual([]);
    await expect(
      Effect.runPromise(effect.pipe(Effect.provide(layer)))
    ).resolves.toBeTruthy();
    expect(checks).toEqual([{ context, permission: "company.members.invite" }]);
    const other = { ...context, authUserId: AuthUserId.make("bob") };
    await expect(
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            Permissions.layerWith(other, { has: () => Effect.succeed(false) })
          )
        )
      )
    ).resolves.toBeFalsy();
  });

  it("denies undeclared runtime input without consulting the permission adapter", async () => {
    let checks = 0;
    const authorization = defineAuthorization(customer);
    // @ts-expect-error Simulates an untyped caller bypassing compile-time checks.
    const effect = authorization.has("registration.decide");
    await expect(
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            Permissions.layerWith(context, {
              has: () =>
                Effect.sync(() => {
                  checks += 1;
                  return true;
                }),
            })
          )
        )
      )
    ).resolves.toBeFalsy();
    expect(checks).toBe(0);
  });

  it("preserves typed lookup failures", async () => {
    const failure = new PermissionCheckFailure({
      message: "Unavailable",
      reason: "unavailable",
    });
    const authorization = defineAuthorization(company);
    await expect(
      Effect.runPromise(
        authorization
          .has("company.members.invite")
          .pipe(
            Effect.provide(
              Layer.succeed(Permissions, { has: () => Effect.fail(failure) })
            ),
            Effect.flip
          )
      )
    ).resolves.toBe(failure);
  });
});
