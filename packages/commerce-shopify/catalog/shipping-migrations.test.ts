import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { makeJsonMigration } from "@repo/cli-core/json-migrations";
import { provisionMigrationGroup } from "@repo/cli-core/provision-migrations";
import { readShippingSetup } from "@repo/commerce-core/provisioning/shipping";
import { Deferred, Effect, Fiber, FileSystem, Layer, Schema } from "effect";
import {
  DestinationChangeDescriptor,
  DestinationError,
  MigrationDefinitionRegistry,
  MigrationExecution,
  MigrationStore,
  MigrationStoreError,
  Tracking,
} from "migrate-sdk";
import { MigrationRunExecutor } from "migrate-sdk/core";
import { FileMigrationStore } from "migrate-sdk/stores/file";
import { InMemoryMigrationStore } from "migrate-sdk/stores/in-memory";
import { vi } from "vitest";

import { makeCatalogAdmin } from "./admin";
import { defineCatalogMigrationConfig } from "./migration-config";
import { makeShippingMigrations } from "./shipping-migrations";

const profileInput = {
  key: "sandbox-shipping",
  locationId: "gid://shopify/Location/7",
  name: "Sandbox shipping",
};
const profileId = "gid://shopify/DeliveryProfile/81";
const locationGroupId = "gid://shopify/DeliveryLocationGroup/92";
const file = new URL(
  "../../commerce-core/provisioning/shipping.example.json",
  import.meta.url
);
const settings = { domain: "fixture.myshopify.com", token: "fixture" };
const zoneId = "gid://shopify/DeliveryZone/3";
const methodId = "gid://shopify/DeliveryMethodDefinition/4";
const RequestBody = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      profile: Schema.optionalKey(
        Schema.Struct({
          coversAllItems: Schema.optionalKey(Schema.Boolean),
          locationGroupsToCreate: Schema.optionalKey(
            Schema.Tuple([
              Schema.Struct({ locationsToAdd: Schema.Tuple([Schema.String]) }),
            ])
          ),
          locationGroupsToUpdate: Schema.optionalKey(
            Schema.Tuple([
              Schema.Struct({
                id: Schema.String,
                zonesToCreate: Schema.optionalKey(Schema.Json),
                zonesToUpdate: Schema.optionalKey(
                  Schema.Tuple([Schema.Struct({ id: Schema.String })])
                ),
              }),
            ])
          ),
          name: Schema.optionalKey(Schema.String),
        })
      ),
    }),
  })
);
const fixture = (
  options: {
    readonly profileOutcome?:
      | "validation"
      | "throttle"
      | "interrupted"
      | "missing-group"
      | "wrong-location"
      | "partial-error";
    readonly throttleZone?: boolean;
  } = {}
) => {
  const pageInfo = { hasNextPage: false };
  const methods: { id: string }[] = [];
  const zone = {
    methodDefinitions: { nodes: methods, pageInfo },
    zone: { id: zoneId },
  };
  const zones: (typeof zone)[] = [];
  const group = {
    locationGroup: {
      id: locationGroupId,
      locations: {
        nodes: [{ id: profileInput.locationId }],
        pageInfo,
      },
    },
    locationGroupZones: { nodes: zones, pageInfo },
  };
  const profile = {
    coversAllItems: true,
    id: profileId,
    profileLocationGroups: [group],
  };
  const writes: string[] = [];
  let created = false;
  let profileRejected = false;
  let zoneRejected = false;
  const fetchApi: typeof fetch = async (url, init) => {
    const { query, variables } = Schema.decodeSync(RequestBody)(
      await new Request(url, init).text()
    );
    if (query.includes("deliveryProfileCreate(")) {
      writes.push("profile");
      expect(variables.profile).toEqual({
        coversAllItems: true,
        locationGroupsToCreate: [{ locationsToAdd: [profileInput.locationId] }],
        name: profileInput.name,
      });
      if (options.profileOutcome === "throttle" && !profileRejected) {
        profileRejected = true;
        return Response.json({
          errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
        });
      }
      if (options.profileOutcome === "validation" && !profileRejected) {
        profileRejected = true;
        return Response.json({
          data: {
            deliveryProfileCreate: {
              profile: null,
              userErrors: [{ message: "Rejected before creation" }],
            },
          },
        });
      }
      created = true;
      if (options.profileOutcome === "interrupted") {
        throw new Error("Mock interruption after profile creation");
      }
      let response = profile;
      if (options.profileOutcome === "missing-group") {
        response = { ...profile, profileLocationGroups: [] };
      }
      if (options.profileOutcome === "wrong-location") {
        response = {
          ...profile,
          profileLocationGroups: [
            {
              ...group,
              locationGroup: {
                ...group.locationGroup,
                locations: {
                  nodes: [{ id: "gid://shopify/Location/99" }],
                  pageInfo,
                },
              },
            },
          ],
        };
      }
      return Response.json({
        data: {
          deliveryProfileCreate: {
            profile: response,
            userErrors:
              options.profileOutcome === "partial-error"
                ? [
                    {
                      message:
                        "Profile created with an incomplete location group",
                    },
                  ]
                : [],
          },
        },
      });
    }
    expect(variables.id).toBe(profileId);
    if (query.startsWith("query")) {
      return Response.json({
        data: { deliveryProfile: created ? profile : null },
      });
    }
    const input = variables.profile?.locationGroupsToUpdate?.[0];
    expect(input?.id).toBe(locationGroupId);
    if (input?.zonesToUpdate) {
      expect(input.zonesToUpdate[0].id).toBe(zoneId);
      writes.push("method");
      methods.push({ id: methodId });
    } else {
      writes.push("zone");
      if (options.throttleZone && !zoneRejected) {
        zoneRejected = true;
        return Response.json({
          errors: [{ extensions: { code: "THROTTLED" }, message: "Throttled" }],
        });
      }
      zones.push(zone);
    }
    return Response.json({
      data: { deliveryProfileUpdate: { profile, userErrors: [] } },
    });
  };
  const store = InMemoryMigrationStore.layer();
  const definitions = makeShippingMigrations({
    admin: makeCatalogAdmin(Effect.succeed(settings), fetchApi),
    profile: profileInput,
    read: readShippingSetup(file),
    store,
  });
  return { definitions, fetchApi, store, writes };
};

describe("Shopify shipping setup", () => {
  it.effect(
    "creates the profile before its Zones and Methods and skips confirmed records on rerun and update",
    () =>
      Effect.gen(function* () {
        const { definitions, store, writes } = fixture();
        const [profiles, zones, methods] = yield* definitions;
        const registry = MigrationDefinitionRegistry.make({
          definitions: [profiles, zones, methods],
        });
        yield* provisionMigrationGroup(registry, "project-setup");
        yield* provisionMigrationGroup(registry, "project-setup");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const started = yield* MigrationExecution.make({ registry }).run({
              group: "project-setup",
              update: true,
            });
            if (started.kind !== "completed" && started.handle !== undefined) {
              yield* started.handle.wait;
            }
          })
        );
        const [profile, zone, method] = yield* Effect.gen(function* () {
          const state = yield* MigrationStore;
          return [
            (yield* state.listItemStates(profiles.id))[0],
            (yield* state.listItemStates(zones.id))[0],
            (yield* state.listItemStates(methods.id))[0],
          ];
        }).pipe(Effect.provide(store));
        expect(profile).toMatchObject({
          journal: {
            process: {
              entries: [
                {
                  value: {
                    operation: "deliveryProfileCreate",
                  },
                },
              ],
            },
          },
          status: "migrated",
          trackingRecord: {
            id: profileId,
            key: profileInput.key,
            locationGroupId,
          },
        });
        expect(zone).toMatchObject({
          journal: {
            process: {
              entries: [{ value: { operation: "deliveryProfileUpdate" } }],
            },
          },
          status: "migrated",
          trackingRecord: { id: zoneId },
        });
        expect(method).toMatchObject({
          status: "migrated",
          trackingRecord: { id: methodId },
        });
        expect(writes).toEqual(["profile", "zone", "method"]);
      })
  );

  it.effect(
    "retries confirmed profile validation and throttle rejections",
    () =>
      Effect.gen(function* () {
        for (const profileOutcome of ["validation", "throttle"] as const) {
          const { definitions, writes } = fixture({ profileOutcome });
          const registry = MigrationDefinitionRegistry.make({
            definitions: yield* definitions,
          });
          const run = provisionMigrationGroup(registry, "project-setup");
          yield* run.pipe(Effect.flip);
          expect(writes).toEqual(["profile"]);
          yield* run;
          expect(writes).toEqual(["profile", "profile", "zone", "method"]);
        }
      })
  );

  it.effect("retains the Profile record while retrying a rejected Zone", () =>
    Effect.gen(function* () {
      const { definitions, writes } = fixture({ throttleZone: true });
      const registry = MigrationDefinitionRegistry.make({
        definitions: yield* definitions,
      });
      const run = provisionMigrationGroup(registry, "project-setup");
      yield* run.pipe(Effect.flip);
      yield* run;
      expect(writes).toEqual(["profile", "zone", "zone", "method"]);
    })
  );

  it.effect(
    "blocks dependents and a second create when the Profile outcome is unconfirmed",
    () =>
      Effect.gen(function* () {
        for (const profileOutcome of [
          "interrupted",
          "missing-group",
          "wrong-location",
          "partial-error",
        ] as const) {
          const { definitions, store, writes } = fixture({ profileOutcome });
          const [profiles, zones, methods] = yield* definitions;
          const registry = MigrationDefinitionRegistry.make({
            definitions: [profiles, zones, methods],
          });
          const run = provisionMigrationGroup(registry, "project-setup");
          yield* run.pipe(Effect.flip);
          yield* run.pipe(Effect.flip);
          const [profile] = yield* MigrationStore.pipe(
            Effect.flatMap((state) => state.listItemStates(profiles.id)),
            Effect.provide(store)
          );
          expect(profile).toMatchObject({
            journal: {
              extensions: {
                "shopify-delivery-profile-create-unconfirmed@v1": true,
              },
            },
            status: "failed",
          });
          expect(profile?.trackingRecord).toBeUndefined();
          if (profileOutcome !== "interrupted") {
            expect(profile?.journal?.process.entries).toMatchObject([
              { kind: "change", value: { operation: "deliveryProfileCreate" } },
            ]);
          }
          expect(writes).toEqual(["profile"]);
        }
      })
  );

  it.effect(
    "can provision after credentials are corrected without clearing migration state",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDirectory = yield* fs.makeTempDirectoryScoped();
        const { fetchApi, writes } = fixture();
        yield* Effect.acquireRelease(
          Effect.sync(() => vi.stubGlobal("fetch", vi.fn(fetchApi))),
          () => Effect.sync(() => vi.unstubAllGlobals())
        );
        const configure = (token?: string) =>
          Effect.promise(
            async () =>
              await defineCatalogMigrationConfig({
                catalogs: {},
                environment: {
                  SHOPIFY_ADMIN_ACCESS_TOKEN: token,
                  SHOPIFY_STORE_DOMAIN: settings.domain,
                },
                shipping: { file, profile: profileInput },
                stateDirectory,
              })
          );
        const first = yield* configure();
        yield* provisionMigrationGroup(first.registry, "project-setup").pipe(
          Effect.flip
        );
        expect(globalThis.fetch).not.toHaveBeenCalled();
        const second = yield* configure(settings.token);
        yield* provisionMigrationGroup(second.registry, "project-setup");
        expect(writes).toEqual(["profile", "zone", "method"]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "can retry token acquisition without reserving a Profile create",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stateDirectory = yield* fs.makeTempDirectoryScoped();
        const { fetchApi, writes } = fixture();
        let refuseToken = true;
        const withTokenEndpoint: typeof fetch = async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith("/admin/oauth/access_token")) {
            return refuseToken
              ? Response.json({ error: "invalid_client" }, { status: 401 })
              : Response.json({
                  access_token: settings.token,
                  expires_in: 3600,
                });
          }
          return await fetchApi(input, init);
        };
        yield* Effect.acquireRelease(
          Effect.sync(() => vi.stubGlobal("fetch", withTokenEndpoint)),
          () => Effect.sync(() => vi.unstubAllGlobals())
        );
        const configure = () =>
          Effect.promise(
            async () =>
              await defineCatalogMigrationConfig({
                catalogs: {},
                environment: {
                  SHOPIFY_ADMIN_CLIENT_ID: "fixture-client",
                  SHOPIFY_ADMIN_CLIENT_SECRET: "fixture-secret",
                  SHOPIFY_STORE_DOMAIN: settings.domain,
                },
                shipping: { file, profile: profileInput },
                stateDirectory,
              })
          );
        const first = yield* configure();
        yield* provisionMigrationGroup(first.registry, "project-setup").pipe(
          Effect.flip
        );
        expect(writes).toEqual([]);
        refuseToken = false;
        const second = yield* configure();
        yield* provisionMigrationGroup(second.registry, "project-setup");
        expect(writes).toEqual(["profile", "zone", "method"]);
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "does not submit a Profile if its reservation cannot be saved",
    () =>
      Effect.gen(function* () {
        const { fetchApi, writes, store: baseStore } = fixture();
        const store = Layer.effect(
          MigrationStore,
          MigrationStore.pipe(
            Effect.map((state) => ({
              ...state,
              upsertItemState: () =>
                Effect.fail(
                  new MigrationStoreError({ message: "Store is unavailable" })
                ),
            }))
          )
        ).pipe(Layer.provide(baseStore));
        const definitions = yield* makeShippingMigrations({
          admin: makeCatalogAdmin(Effect.succeed(settings), fetchApi),
          profile: profileInput,
          read: readShippingSetup(file),
          store,
        });
        const registry = MigrationDefinitionRegistry.make({ definitions });
        yield* provisionMigrationGroup(registry, "project-setup").pipe(
          Effect.flip
        );
        expect(writes).toEqual([]);
      })
  );

  it.effect(
    "persists the Profile reservation before submission and blocks replay after interruption",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const store = FileMigrationStore.layer({ directory });
        const submitted = yield* Deferred.make<boolean>();
        let writes = 0;
        const definitions = yield* makeShippingMigrations({
          admin: {
            ...makeCatalogAdmin(Effect.succeed(settings)),
            request: () =>
              Effect.gen(function* () {
                writes += 1;
                yield* Deferred.succeed(submitted, true);
                // The provider committed; this process never receives its response.
                return yield* Effect.never;
              }),
          },
          profile: profileInput,
          read: readShippingSetup(file),
          store,
        });
        const registry = MigrationDefinitionRegistry.make({ definitions });
        const plan = yield* registry.executable().planRun({
          group: "project-setup",
          withDependencies: true,
        });
        const run = yield* MigrationRunExecutor.executePlan(plan).pipe(
          Effect.provide(MigrationRunExecutor.layer),
          Effect.forkChild
        );
        yield* Deferred.await(submitted);
        const readState = MigrationStore.pipe(
          Effect.flatMap((state) => state.listItemStates(definitions[0].id)),
          Effect.provide(FileMigrationStore.layer({ directory }))
        );
        const [pending] = yield* readState;
        expect(pending).toMatchObject({
          error: { errorTag: "TrackingCheckpoint" },
          journal: {
            extensions: {
              "shopify-delivery-profile-create-unconfirmed@v1": true,
            },
          },
          status: "failed",
        });
        expect(pending?.trackingRecord).toBeUndefined();
        yield* Fiber.interrupt(run);
        yield* provisionMigrationGroup(registry, "project-setup").pipe(
          Effect.flip
        );
        expect(writes).toBe(1);
        const [after] = yield* readState;
        expect(
          after?.status === "failed" ? after.error.message : undefined
        ).toContain("did not confirm the earlier Delivery Profile create");
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect(
    "plans Profile and Zone prerequisites through the configured SDK registry",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const stateDirectory = `${directory}/state`;
        const config = yield* Effect.promise(
          async () =>
            await defineCatalogMigrationConfig({
              catalogs: {},
              environment: {},
              shipping: { file, profile: profileInput },
              stateDirectory,
            })
        );
        const plan = yield* config.registry.planRun({
          definitionIds: ["shopify-shipping-methods"],
          withDependencies: true,
        });
        expect(plan.executionDefinitionIds).toEqual([
          "shopify-delivery-profiles",
          "shopify-shipping-zones",
          "shopify-shipping-methods",
        ]);
        expect(yield* fs.exists(stateDirectory)).toBeFalsy();
      }).pipe(Effect.provide(NodeServices.layer))
  );

  it.effect("keeps shipping records when the catalog publication changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDirectory = yield* fs.makeTempDirectoryScoped();
      const { fetchApi, writes } = fixture();
      const environment = {
        SHOPIFY_ADMIN_ACCESS_TOKEN: settings.token,
        SHOPIFY_STORE_DOMAIN: settings.domain,
      };
      yield* Effect.acquireRelease(
        Effect.sync(() => vi.stubGlobal("fetch", fetchApi)),
        () => Effect.sync(() => vi.unstubAllGlobals())
      );
      const configure = (publicationId?: string) =>
        Effect.promise(
          async () =>
            await defineCatalogMigrationConfig({
              catalogs: {},
              environment: {
                ...environment,
                SHOPIFY_CATALOG_PUBLICATION_ID: publicationId,
              },
              shipping: { file, profile: profileInput },
              stateDirectory,
            })
        );
      const first = yield* configure();
      yield* provisionMigrationGroup(first.registry, "project-setup");
      const second = yield* configure("gid://shopify/Publication/5");
      yield* provisionMigrationGroup(second.registry, "project-setup");
      expect(writes).toEqual(["profile", "zone", "method"]);
    }).pipe(Effect.provide(NodeServices.layer))
  );
});

describe("Migrate SDK destination journal", () => {
  it.effect(
    "preserves acknowledged writes from consecutive failed attempts",
    () =>
      Effect.gen(function* () {
        const Input = Schema.Struct({ key: Schema.NonEmptyString });
        const Entity = Schema.Struct({
          ...Input.fields,
          id: Schema.NonEmptyString,
        });
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const store = FileMigrationStore.layer({ directory });
        const descriptor = DestinationChangeDescriptor.make(
          "acknowledged-write@v1",
          Schema.Int
        );
        let writes = 0;
        const definition = yield* makeJsonMigration({
          destination: {
            entity: Entity,
            reference: (entity) => ({ id: entity.id, key: entity.key }),
            write: () =>
              Effect.gen(function* () {
                writes += 1;
                yield* Tracking.recordChange(descriptor, writes).pipe(
                  Effect.mapError(
                    (cause) =>
                      new DestinationError({
                        cause,
                        message: "Could not journal write",
                      })
                  )
                );
                return yield* new DestinationError({
                  message: "Later step failed",
                });
              }),
          },
          group: "provision",
          id: "customers",
          input: {
            items: [{ key: "customer" }],
            key: (item) => item.key,
            schema: Input,
          },
          revision: "v1",
          store,
        });
        const registry = MigrationDefinitionRegistry.make({
          definitions: [definition],
        });
        const run = provisionMigrationGroup(registry, "provision").pipe(
          Effect.flip
        );
        yield* run;
        yield* run;
        const [item] = yield* MigrationStore.pipe(
          Effect.flatMap((state) => state.listItemStates(definition.id)),
          Effect.provide(FileMigrationStore.layer({ directory }))
        );
        expect(item?.journal?.processAttempts?.[0]?.entries[0]).toMatchObject({
          value: 1,
        });
        expect(item?.journal?.process.entries[0]).toMatchObject({ value: 2 });
        expect(item?.journal?.processAttempts?.[0]?.runId).not.toBe(
          item?.journal?.process.runId
        );
      }).pipe(Effect.provide(NodeServices.layer))
  );
});
