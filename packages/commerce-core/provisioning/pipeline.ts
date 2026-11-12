import { createHash } from "node:crypto";
import nodePath from "node:path";

import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthDataProvisioner,
  AuthDataProvisioningFailure,
} from "@repo/auth-contract/data-provisioning";
import type {
  AuthDataProvisionerValue,
  RecordAuthProvisioningWrite,
} from "@repo/auth-contract/data-provisioning";
import { PermissionGrantInput } from "@repo/auth-contract/permission-grant-input";
import { PermissionGrant } from "@repo/auth-contract/permissions";
import { storefrontPermissions } from "@repo/auth-contract/permissions/storefront";
import {
  AuthUserInput,
  ProvisionedAuthUser,
} from "@repo/auth-contract/user-input";
import {
  phase,
  renderReport,
  withCommandOutput,
} from "@repo/cli-core/command-output";
import {
  makeJsonMigration,
  readJsonInputs,
  readSourceFile,
} from "@repo/cli-core/json-migrations";
import type {
  ProvisioningReferences,
  JsonMigrationDestination,
} from "@repo/cli-core/json-migrations";
import {
  provisionMigrationGroup,
  ProvisioningRunFailed,
} from "@repo/cli-core/provision-migrations";
import {
  migrationPlanReport,
  migrationRunReport,
} from "@repo/cli-core/provisioning-output";
import {
  Console,
  Context,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
} from "effect";
import type { Layer, ConfigProvider } from "effect";
import { CliError, Command, Flag } from "effect/cli";
import {
  DestinationChangeDescriptor,
  DestinationError,
  MigrationDefinitionRegistry,
  Tracking,
} from "migrate-sdk";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationStore,
  MigrationStoreError,
  MigrationDefinitionRegistry as Registry,
} from "migrate-sdk";
import { FileMigrationStore } from "migrate-sdk/stores/file";

import {
  CompanyCatalogAssignments,
  companyCatalogPlans,
} from "../catalog/company";
import { assertGeneratedModel } from "../catalog/files";
import { Catalog, CatalogName, validateCatalog } from "../catalog/model";
import { productModel } from "../catalog/product-model";
import { SellingCatalog, decodeSellingCatalog } from "../catalog/selling";
import type { Customer } from "../domain/customer";
import { CustomerInput, CommerceCustomerId } from "../domain/customer";
import {
  CustomerIdentityLink,
  CustomerIdentityLinkInput,
} from "../domain/customer-identity-link";
import {
  AssortmentInput,
  CatalogPriceListInput,
  CompanyPricingGroupInput,
} from "../domain/pricing";
import { loadCustomerProvisioningInputs } from "./inputs";

export const ProfileFiles = Schema.Struct({
  assignmentsFile: Schema.optionalKey(Schema.NonEmptyString),
  catalogFile: Schema.NonEmptyString,
  catalogName: CatalogName,
  sellingFile: Schema.optionalKey(Schema.NonEmptyString),
  priceListsFile: Schema.optionalKey(Schema.NonEmptyString),
  pricingGroupsFile: Schema.optionalKey(Schema.NonEmptyString),
  assortmentsFile: Schema.optionalKey(Schema.NonEmptyString),
});
export const readProfileDocument = <A, I>(
  schema: Schema.Codec<A, I>,
  file: string
) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.readFileString(file)),
    Effect.flatMap((json) =>
      Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.toCodecJson(schema))
      )(json, { onExcessProperty: "error" })
    )
  );
/** Validates catalog and pricing references before a registry can execute. */
export const loadProvisioningCatalog = (directory: string) =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: assertGeneratedModel,
      catch: () =>
        new DestinationError({
          message:
            "Generate the domain product model before provisioning: pnpm --filter @repo/commerce-core catalog generate",
        }),
    });
    const path = yield* Path.Path;
    const files = yield* readProfileDocument(
      ProfileFiles,
      path.join(directory, "setup.json")
    );
    const catalogFile = path.resolve(directory, files.catalogFile);
    const raw = yield* readProfileDocument(Catalog, catalogFile);
    const catalog = yield* Effect.try({
      catch: () =>
        new DestinationError({ message: "Invalid profile catalog." }),
      try: () => validateCatalog(raw, productModel),
    });
    const catalogs = { [files.catalogName]: catalog };
    const separate = [
      files.priceListsFile,
      files.pricingGroupsFile,
      files.assortmentsFile,
    ];
    const separateCount = separate.filter((file) => file !== undefined).length;
    if (separateCount > 0 && (separateCount !== 3 || !files.sellingFile)) {
      return yield* new DestinationError({
        message:
          "Separate pricing sources require sellingFile, priceListsFile, pricingGroupsFile and assortmentsFile together.",
      });
    }
    let sellingRaw: Schema.Json | undefined;
    if (files.sellingFile) {
      if (
        files.priceListsFile &&
        files.pricingGroupsFile &&
        files.assortmentsFile
      ) {
        // A header contains no duplicate arrays; exactly one file owns each entity set.
        const header = yield* readProfileDocument(
          Schema.Struct({
            key: SellingCatalog.fields.key,
            sourceCatalog: SellingCatalog.fields.sourceCatalog,
            stores: SellingCatalog.fields.stores,
          }),
          path.resolve(directory, files.sellingFile)
        );
        const priceLists = yield* readJsonInputs(
          CatalogPriceListInput,
          path.resolve(directory, files.priceListsFile)
        );
        const pricingGroups = yield* readJsonInputs(
          CompanyPricingGroupInput,
          path.resolve(directory, files.pricingGroupsFile)
        );
        const assortments = yield* readJsonInputs(
          AssortmentInput,
          path.resolve(directory, files.assortmentsFile)
        );
        sellingRaw = { ...header, priceLists, pricingGroups, assortments };
      } else {
        sellingRaw = yield* readProfileDocument(
          Schema.Json,
          path.resolve(directory, files.sellingFile)
        );
      }
    }
    const selling =
      sellingRaw === undefined
        ? undefined
        : yield* Effect.try({
            catch: () =>
              new DestinationError({
                message: "Invalid profile selling catalog.",
              }),
            try: () => decodeSellingCatalog(sellingRaw, catalogs),
          });
    const assignments = files.assignmentsFile
      ? yield* readProfileDocument(
          CompanyCatalogAssignments,
          path.resolve(directory, files.assignmentsFile)
        )
      : undefined;
    if (Boolean(selling) !== Boolean(assignments)) {
      return yield* new DestinationError({
        message:
          "Supply both sellingFile and assignmentsFile for company pricing.",
      });
    }
    const plans =
      selling && assignments
        ? yield* Effect.try({
            catch: () =>
              new DestinationError({
                message: "Invalid company catalog assignments.",
              }),
            try: () => companyCatalogPlans(assignments, selling, catalogs),
          })
        : [];
    return { catalogFile, catalogs, files, plans, selling };
  });
export type ProvisioningCatalog = Effect.Success<
  ReturnType<typeof loadProvisioningCatalog>
>;
export type ProvisioningStore = Layer.Layer<
  MigrationStore,
  MigrationStoreError
>;
export interface CustomerProvisioningTargets {
  readonly target: string;
  readonly customers: JsonMigrationDestination<
    CustomerInput,
    Customer,
    typeof Customer.Encoded
  >;
  readonly linkIdentity: (
    input: CustomerIdentityLink
  ) => Effect.Effect<CustomerIdentityLink, DestinationError, Tracking>;
  readonly catalogDefinitions: (
    catalog: ProvisioningCatalog,
    store: ProvisioningStore
  ) => readonly AnySelfContainedMigrationDefinition[];
}
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Fingerprints accept already-validated domain values; file decoding owns validation.
export const sourceRevision = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const destinationFailure = (error: AuthDataProvisioningFailure) =>
  new DestinationError({
    message: error.message,
  });
const AuthProvisioningChange = DestinationChangeDescriptor.make(
  "auth-provisioning-write@v1",
  Schema.Struct({ operation: Schema.String, userId: Schema.String })
);
export const authProvisioningJournal = Tracking.pipe(
  Effect.map(
    (tracking): RecordAuthProvisioningWrite =>
      (operation, userId) =>
        tracking
          .recordChange(AuthProvisioningChange, { operation, userId })
          .pipe(
            Effect.asVoid,
            Effect.mapError(
              () =>
                new AuthDataProvisioningFailure({
                  message: `Cannot journal acknowledged auth write ${operation}`,
                })
            )
          )
  )
);
export const makeCustomerProfileMigrations = (
  directory: string,
  targets: CustomerProvisioningTargets,
  auth: AuthDataProvisionerValue,
  store: ProvisioningStore
) =>
  Effect.gen(function* () {
    const users = yield* makeJsonMigration({
      destination: {
        entity: ProvisionedAuthUser,
        reference: (entity) => ({ id: entity.id, key: entity.key }),
        write: (input) =>
          Effect.gen(function* () {
            const journal = yield* authProvisioningJournal;
            return yield* auth
              .upsertUser(input, journal)
              .pipe(Effect.mapError(destinationFailure));
          }),
      },
      group: "provision",
      id: "auth-users",
      input: {
        read: readSourceFile(
          readJsonInputs(
            AuthUserInput,
            nodePath.resolve(directory, "auth-users.json")
          )
        ),
        key: (input) => input.key,
        schema: AuthUserInput,
      },
      revision: "auth-user-v1",
      store,
    });
    const customers = yield* makeJsonMigration({
      destination: targets.customers,
      group: "provision",
      id: "customers",
      input: {
        read: readSourceFile(
          readJsonInputs(
            CustomerInput,
            nodePath.resolve(directory, "customers.json")
          )
        ),
        key: (input) => input.key,
        schema: CustomerInput,
      },
      revision: "customer-v1",
      store,
    });
    const identities = yield* makeJsonMigration({
      dependencies: [users, customers],
      destination: {
        entity: CustomerIdentityLink,
        reference: (entity, input) => ({
          id: entity.customerId,
          key: input.authUserKey,
        }),
        write: (input, references) =>
          Effect.gen(function* () {
            const user = yield* references.get(users, input.authUserKey);
            const customer = yield* references.get(
              customers,
              input.customerKey
            );
            return yield* targets.linkIdentity({
              authUserId: AuthUserId.make(user.id),
              customerId: CommerceCustomerId.make(customer.id),
            });
          }),
      },
      group: "provision",
      id: "customer-identity-links",
      input: {
        read: readSourceFile(
          readJsonInputs(
            CustomerIdentityLinkInput,
            nodePath.resolve(directory, "customer-identity-links.json")
          )
        ),
        key: (input) => input.authUserKey,
        schema: CustomerIdentityLinkInput,
      },
      revision: "customer-identity-link-v1",
      store,
    });
    return {
      customers,
      definitions: [users, customers, identities],
      identities,
      users,
    };
  });
export const makePermissionGrantMigration = (options: {
  readonly file: string;
  readonly users: AnySelfContainedMigrationDefinition;
  readonly dependencies: readonly AnySelfContainedMigrationDefinition[];
  readonly auth: AuthDataProvisionerValue;
  readonly store: ProvisioningStore;
  readonly revision: string;
  readonly resolveScope: (
    input: PermissionGrantInput,
    references: ProvisioningReferences
  ) => Effect.Effect<string, DestinationError>;
}) =>
  makeJsonMigration({
    dependencies: [options.users, ...options.dependencies],
    destination: {
      entity: PermissionGrant,
      reference: (grant, input) => ({
        id: JSON.stringify([
          grant.authUserId,
          grant.scope.type,
          grant.scope.id,
        ]),
        key: input.key,
      }),
      write: (input, references) =>
        Effect.gen(function* () {
          const user = yield* references.get(options.users, input.authUserKey);
          const id = yield* options.resolveScope(input, references);
          const journal = yield* authProvisioningJournal;
          return yield* options.auth
            .setGrant(
              {
                authUserId: AuthUserId.make(user.id),
                permissions: input.permissions,
                scope: { id, type: input.scope.type },
              },
              journal
            )
            .pipe(Effect.mapError(destinationFailure));
        }),
    },
    group: "provision",
    id: "storefront-permission-grants",
    input: {
      read: readSourceFile(readJsonInputs(PermissionGrantInput, options.file)),
      key: (input) => input.key,
      schema: PermissionGrantInput,
    },
    revision: options.revision,
    store: options.store,
  });
/** A terminal definition makes every selected stage a prerequisite of the one provisioning group. */
export const completeProfileRegistry = (
  definitions: readonly AnySelfContainedMigrationDefinition[],
  store: ProvisioningStore,
  revision: string
) =>
  Effect.gen(function* () {
    const receipt = Schema.Struct({
      id: Schema.NonEmptyString,
      key: Schema.NonEmptyString,
    });
    const complete = yield* makeJsonMigration({
      dependencies: definitions,
      destination: {
        entity: receipt,
        reference: (entity) => entity,
        write: (input) => Effect.succeed(input),
      },
      group: "provision",
      id: "profile-complete",
      input: {
        items: [{ id: "profile", key: "profile" }],
        key: (item) => item.key,
        schema: receipt,
      },
      revision,
      store,
    });
    return MigrationDefinitionRegistry.make({
      definitions: [...definitions, complete],
    });
  });
export interface PreparedProvisioningProfile {
  readonly target: string;
  readonly build: (
    store: ProvisioningStore
  ) => Effect.Effect<
    Registry<readonly AnySelfContainedMigrationDefinition[]>,
    DestinationError
  >;
}
export interface ProfilePreparation {
  readonly directory: string;
  readonly bindingsFile?: string;
  readonly taxesFile?: string;
  readonly taxConfigFile?: string;
  readonly config: ConfigProvider.ConfigProvider;
  readonly auth: AuthDataProvisionerValue;
}
export class CommerceProvisioningProfile extends Context.Service<
  CommerceProvisioningProfile,
  {
    readonly prepare: (
      options: ProfilePreparation
    ) => Effect.Effect<
      PreparedProvisioningProfile,
      DestinationError,
      FileSystem.FileSystem | Path.Path
    >;
  }
>()("@repo/commerce-core/CommerceProvisioningProfile") {}
export const prepareCustomerProfile = (
  options: ProfilePreparation,
  targets: CustomerProvisioningTargets,
  permissions: readonly string[] = storefrontPermissions
) =>
  Effect.gen(function* () {
    const inputs = yield* loadCustomerProvisioningInputs(options.directory);
    const catalog = yield* loadProvisioningCatalog(options.directory);
    if (catalog.selling) {
      return yield* new DestinationError({
        message: "Company setup requires the B2B provisioning recipe.",
      });
    }
    const path = yield* Path.Path;
    const grants = yield* readJsonInputs(
      PermissionGrantInput,
      path.join(options.directory, "storefront-permission-grants.json")
    );
    const keys = new Set<string>();
    const scopes = new Set<string>();
    for (const grant of grants) {
      const link = inputs.identityLinks.find(
        (item) =>
          item.authUserKey === grant.authUserKey &&
          item.customerKey === grant.scope.key
      );
      const scope = JSON.stringify([
        grant.authUserKey,
        grant.scope.type,
        grant.scope.key,
      ]);
      if (
        !link ||
        grant.scope.type !== "customer" ||
        keys.has(grant.key) ||
        scopes.has(scope) ||
        grant.permissions.some(
          (permission) => !new Set<string>(permissions).has(permission)
        )
      ) {
        return yield* new DestinationError({
          message:
            "B2C permission grants require unique Customer scopes linked to the declared user and installed permissions.",
        });
      }
      keys.add(grant.key);
      scopes.add(scope);
    }
    const revision = sourceRevision([inputs, catalog, grants]);
    return {
      build: (store: ProvisioningStore) =>
        Effect.gen(function* () {
          const common = yield* makeCustomerProfileMigrations(
            options.directory,
            targets,
            options.auth,
            store
          );
          const permissions = yield* makePermissionGrantMigration({
            auth: options.auth,
            dependencies: [common.identities],
            file: path.join(
              options.directory,
              "storefront-permission-grants.json"
            ),
            resolveScope: (input, references) =>
              Effect.gen(function* () {
                const customer = yield* references.get(
                  common.customers,
                  input.scope.key
                );
                const link = yield* references.get(
                  common.identities,
                  input.authUserKey
                );
                if (link.id !== customer.id) {
                  return yield* new DestinationError({
                    message:
                      "Permission grant requires the migrated link to its declared Customer.",
                  });
                }
                return customer.id;
              }),
            revision: "customer-permission-grant-v1",
            store,
            users: common.users,
          });
          return yield* completeProfileRegistry(
            [
              ...common.definitions,
              permissions,
              ...targets.catalogDefinitions(catalog, store),
            ],
            store,
            revision
          );
        }),
      target: targets.target,
    };
  });
/** Compose the same definitions and file store when another domain depends on commerce. */
export const prepareDataRegistry = (
  config: ConfigProvider.ConfigProvider,
  prepare: (
    options: ProfilePreparation
  ) => Effect.Effect<
    PreparedProvisioningProfile,
    DestinationError,
    FileSystem.FileSystem | Path.Path
  >,
  options: {
    directory: string;
    stateDirectory: string;
    bindingsFile?: string;
    taxesFile?: string;
    taxConfigFile?: string;
  }
) =>
  Effect.gen(function* () {
    const provider = yield* Effect.serviceOption(AuthDataProvisioner);
    if (Option.isNone(provider)) {
      return yield* new DestinationError({
        message: "Install the selected auth provider's provisioning recipe.",
      });
    }
    const auth = yield* provider.value.prepare(config);
    const selected = yield* Effect.serviceOption(CommerceProvisioningProfile);
    const profile = yield* (
      Option.isSome(selected) ? selected.value.prepare : prepare
    )({
      auth,
      bindingsFile: options.bindingsFile,
      taxesFile: options.taxesFile,
      taxConfigFile: options.taxConfigFile,
      config,
      directory: options.directory,
    });
    const path = yield* Path.Path;
    const namespace = sourceRevision([
      "profile-v1",
      profile.target,
      auth.target,
    ]);
    const store = FileMigrationStore.layer({
      directory: path.resolve(options.stateDirectory, namespace),
    });
    const registry = yield* profile.build(store);

    return {
      registry,
      store,
      target: JSON.stringify([profile.target, auth.target]),
    };
  });
/** The command owns execution; selected recipes supply profile preparation. */
export const makeSetupCommand = <E, R>(
  source: Effect.Effect<ConfigProvider.ConfigProvider, E, R>,
  prepare: (
    options: ProfilePreparation
  ) => Effect.Effect<
    PreparedProvisioningProfile,
    DestinationError,
    FileSystem.FileSystem | Path.Path
  >
) =>
  Command.make(
    "setup",
    {
      bindingsFile: Flag.String("bindings").pipe(Flag.optional),
      taxesFile: Flag.String("taxes").pipe(Flag.optional),
      taxConfigFile: Flag.String("tax-config").pipe(Flag.optional),
      directory: Flag.String("directory"),
      plan: Flag.Boolean("plan").pipe(Flag.withDefault(false)),
      stateDirectory: Flag.String("state-directory").pipe(
        Flag.withDefault(".migrate")
      ),
    },
    ({
      directory,
      bindingsFile,
      taxesFile,
      taxConfigFile,
      plan,
      stateDirectory,
    }) =>
      withCommandOutput(
        {
          title: "Set up commerce data",
          context: directory,
          failureNote:
            "Earlier stages may have completed. Inspect Migrate progress and the failed stage before retrying.",
        },
        (style) =>
          Effect.gen(function* () {
            const config = yield* source;
            const { registry } = yield* prepareDataRegistry(config, prepare, {
              directory,
              stateDirectory,
              bindingsFile: Option.getOrUndefined(bindingsFile),
              taxesFile: Option.getOrUndefined(taxesFile),
              taxConfigFile: Option.getOrUndefined(taxConfigFile),
            });
            if (plan) {
              const planned = yield* registry.planRun({
                group: "provision",
                withDependencies: true,
              });
              yield* Console.log(
                renderReport(
                  migrationPlanReport(planned.includedDefinitionIds, directory),
                  style
                )
              );
              return;
            }
            // One root group includes catalog prerequisites as explicit dependencies below.
            const summary = yield* phase(
              {
                group: "Commerce data",
                title: "Apply the selected provisioning profile",
              },
              provisionMigrationGroup(registry, "provision")
            );
            yield* Console.log(
              renderReport(migrationRunReport(summary, stateDirectory), style)
            );
          }).pipe(
            Effect.mapError((cause) => {
              let userMessage =
                "Setup failed. Check profile files and provider configuration.";
              if (cause instanceof DestinationError) {
                userMessage = cause.message;
              }
              if (cause instanceof ProvisioningRunFailed) {
                const failed = cause.failedDefinitions ?? [];
                const stages = failed.length ? failed.join(", ") : "startup";
                const diagnostics = (cause.failures ?? [])
                  .map(
                    ({ definitionId, message }) => `${definitionId}: ${message}`
                  )
                  .join("\n");
                userMessage = `Setup failed. Run: ${cause.runId ?? "not started"}. Failed stages: ${stages}.${diagnostics ? `\n${diagnostics}` : " Inspect Migrate progress before retrying."}`;
              }
              return new CliError.UserError({ cause: undefined, userMessage });
            })
          )
      )
  );
