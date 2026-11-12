import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { AuthUserId } from "@repo/auth-contract/access-token";
import { ProvisionedAuthUser } from "@repo/auth-contract/user-input";
import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import {
  Customer,
  CommerceCustomerId,
} from "@repo/commerce-core/domain/customer";
import { prepareCustomerProfile } from "@repo/commerce-core/provisioning/pipeline";
import type { CustomerProvisioningTargets } from "@repo/commerce-core/provisioning/pipeline";
import { ConfigProvider, Effect, Redacted, Schema } from "effect";
import {
  DestinationError,
  MigrationDefinition,
  SourceIdentity,
} from "migrate-sdk";
import { InMemorySource } from "migrate-sdk/sources/in-memory";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";

import { customerPermissions } from "../permissions";

describe("Complete B2C provisioning group", () => {
  it.effect(
    "provisions the Customer-scoped grant only after the shopper's identity link succeeds",
    () =>
      Effect.gen(function* () {
        const writes: string[] = [];
        let identityConflicts = true;
        const targets: CustomerProvisioningTargets = {
          catalogDefinitions: (_, store) => [
            MigrationDefinition.make({
              group: "catalog",
              id: "catalog",
              process: () =>
                Effect.sync(() => {
                  writes.push("catalog");
                }),
              source: InMemorySource.make({
                identity: SourceIdentity.make({
                  id: "catalog-key",
                  schema: SourceIdentity.key("key", Schema.NonEmptyString),
                }),
                items: [
                  { identityKey: "catalog", item: "catalog", version: "v1" },
                ],
                sourceSchema: Schema.String,
              }),
              store,
            }),
          ],
          customers: {
            entity: Customer,
            reference: (entity) => ({
              id: entity.customerId,
              key: entity.key ?? "",
            }),
            write: (input) =>
              Effect.sync(() => {
                writes.push("customer");
                return Customer.make({
                  ...input,
                  customerId: CommerceCustomerId.make("native-customer"),
                  firstName: input.firstName ?? Redacted.make(""),
                  lastName: input.lastName ?? Redacted.make(""),
                });
              }),
          },
          linkIdentity: (input) =>
            Effect.suspend(() => {
              if (identityConflicts) {
                return new DestinationError({
                  message: "Conflicting identity link",
                });
              }
              expect(input).toEqual({
                authUserId: "native-auth",
                customerId: "native-customer",
              });
              writes.push("identity");
              return Effect.succeed(input);
            }),
          target: "commerce:test",
        };
        const profile = yield* prepareCustomerProfile(
          {
            auth: {
              setRoles: () => Effect.void,
              setGrant: (input) =>
                Effect.sync(() => {
                  expect(input.scope).toEqual({
                    id: "native-customer",
                    type: "customer",
                  });
                  expect(input.permissions).toEqual(customerPermissions);
                  writes.push("grant");
                  return input;
                }),
              target: "auth:test",
              upsertUser: (input) =>
                Effect.sync(() => {
                  writes.push("auth");
                  return ProvisionedAuthUser.make({
                    email: input.email,
                    firstName: input.firstName ?? null,
                    id: AuthUserId.make("native-auth"),
                    key: input.key,
                    lastName: input.lastName ?? null,
                    profilePictureUrl: null,
                  });
                }),
            },
            config: ConfigProvider.fromEnv(),
            directory: import.meta.dirname,
          },
          targets,
          customerPermissions
        );
        const registry = yield* profile.build(
          InMemoryMigrationStore.layer(InMemoryMigrationStore.makeState())
        );
        const planned = yield* registry.planRun({
          group: "provision",
          withDependencies: true,
        });
        expect({
          catalog: planned.includedDefinitionIds.some((id) => id === "catalog"),
          businessUnit: planned.includedDefinitionIds.some((id) =>
            id.includes("business-unit")
          ),
        }).toEqual({ businessUnit: false, catalog: true });
        expect(writes).toEqual([]);
        yield* provisionMigrationGroup(registry, "provision").pipe(Effect.flip);
        expect(writes).not.toContain("grant");
        identityConflicts = false;
        yield* provisionMigrationGroup(registry, "provision");
        expect(writes).toEqual(
          expect.arrayContaining([
            "auth",
            "catalog",
            "customer",
            "grant",
            "identity",
          ])
        );
        yield* provisionMigrationGroup(registry, "provision");
        expect(writes).toHaveLength(5);
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
