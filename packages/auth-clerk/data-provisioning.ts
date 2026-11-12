import { isDeepStrictEqual } from "node:util";

import { createClerkClient } from "@clerk/backend";
import { AuthUserId } from "@repo/auth-contract/access-token";
import {
  AuthDataProvisioner,
  AuthDataProvisioningFailure,
  mergePermissionGrant,
} from "@repo/auth-contract/data-provisioning";
import type {
  AuthDataProvisionerValue,
  RecordAuthProvisioningWrite,
} from "@repo/auth-contract/data-provisioning";
import { IdentityMembershipProjectionFailure } from "@repo/auth-contract/identity-memberships";
import type { PermissionGrant } from "@repo/auth-contract/permissions";
import { IdentityRoleAssignments } from "@repo/auth-contract/role-assignments";
import { ProvisionedAuthUser } from "@repo/auth-contract/user-input";
import type { AuthUserInput } from "@repo/auth-contract/user-input";
import {
  Config,
  ConfigProvider,
  Effect,
  Layer,
  Redacted,
  Schema,
} from "effect";
import type { Effect as EffectType } from "effect";

import { identityRoleAssignmentsLayerWith } from "./identity-roles";

type Users = ReturnType<typeof createClerkClient>["users"];
const ClerkPublicMetadata = Schema.Record(Schema.String, Schema.Unknown);
export type ClerkProvisioningMetadata = typeof ClerkPublicMetadata.Type;
interface ClerkProvisioningUser {
  readonly id: string;
  readonly externalId: string | null;
  readonly primaryEmailAddressId: string | null;
  readonly emailAddresses: readonly {
    readonly id: string;
    readonly emailAddress: string;
  }[];
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly imageUrl?: string;
  readonly publicMetadata: ClerkProvisioningMetadata;
}
export interface ClerkProvisioningUsers {
  readonly getUserList: (
    input: Parameters<Users["getUserList"]>[0]
  ) => Promise<{
    readonly data: readonly ClerkProvisioningUser[];
    readonly totalCount: number;
  }>;
  readonly getUser: (id: string) => Promise<ClerkProvisioningUser>;
  readonly createUser: (
    input: Parameters<Users["createUser"]>[0]
  ) => Promise<ClerkProvisioningUser>;
  readonly updateUser: (
    id: string,
    input: Parameters<Users["updateUser"]>[1]
  ) => Promise<ClerkProvisioningUser>;
  readonly updateUserMetadata: (
    id: string,
    input: Parameters<Users["updateUserMetadata"]>[1]
  ) => Promise<ClerkProvisioningUser>;
}
const fail = () =>
  new AuthDataProvisioningFailure({
    message:
      "Clerk data provisioning failed. Check native user conflicts, metadata and API access before retrying.",
  });
const request = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: fail, try: run });
export const makeClerkDataProvisioner = (
  target: string,
  client: EffectType.Effect<ClerkProvisioningUsers, AuthDataProvisioningFailure>
): AuthDataProvisionerValue => ({
  setGrant: Effect.fn("Clerk.provisionPermissionGrant")(function* (
    grant: PermissionGrant,
    recordWrite?: RecordAuthProvisioningWrite
  ) {
    if (grant.scope.type === "organization") {
      return yield* fail();
    }
    const users = yield* client;
    const user = yield* request(
      async () => await users.getUser(grant.authUserId)
    );
    if (user.id !== grant.authUserId) {
      return yield* fail();
    }
    const document = yield* mergePermissionGrant(
      user.publicMetadata.application_permissions,
      grant
    );
    const saved = yield* request(
      async () =>
        await users.updateUserMetadata(user.id, {
          publicMetadata: { application_permissions: document },
        })
    );
    yield* recordWrite?.("grant.update", user.id) ?? Effect.void;
    if (
      !isDeepStrictEqual(saved.publicMetadata.application_permissions, document)
    ) {
      return yield* fail();
    }
    return { ...grant, authUserId: AuthUserId.make(saved.id) };
  }),
  setRoles: (assignment, recordWrite) =>
    client.pipe(
      Effect.flatMap((users) =>
        IdentityRoleAssignments.pipe(
          Effect.flatMap((roles) =>
            roles.set(
              assignment,
              recordWrite?.("roles.update", assignment.authUserId).pipe(
                Effect.mapError(
                  (cause) =>
                    new IdentityMembershipProjectionFailure({
                      cause,
                      message: cause.message,
                      operation: "project",
                      reason: "unavailable",
                    })
                )
              )
            )
          ),
          Effect.provide(
            identityRoleAssignmentsLayerWith({
              getUser: async (id) => await users.getUser(id),
              updateUserMetadata: async (id, input) => {
                await users.updateUserMetadata(id, input);
              },
            })
          )
        )
      ),
      Effect.mapError(fail)
    ),
  target,
  upsertUser: Effect.fn("Clerk.provisionUser")(function* (
    input: AuthUserInput,
    recordWrite?: RecordAuthProvisioningWrite
  ) {
    const users = yield* client;
    const found = yield* request(
      async () => await users.getUserList({ externalId: [input.key], limit: 2 })
    );
    let [user] = found.data;
    if (found.totalCount > 1 || (user && user.externalId !== input.key)) {
      return yield* fail();
    }
    if (user) {
      const { primaryEmailAddressId } = user;
      const email = user.emailAddresses.find(
        ({ id }) => id === primaryEmailAddressId
      )?.emailAddress;
      if (email?.toLowerCase() !== input.email.toLowerCase()) {
        return yield* fail();
      }
      if (
        (input.firstName !== undefined && input.firstName !== user.firstName) ||
        (input.lastName !== undefined && input.lastName !== user.lastName)
      ) {
        const { id } = user;
        user = yield* request(
          async () =>
            await users.updateUser(id, {
              firstName: input.firstName,
              lastName: input.lastName,
            })
        );
        yield* recordWrite?.("user.update", user.id) ?? Effect.void;
      }
    } else {
      user = yield* request(
        async () =>
          await users.createUser({
            emailAddress: [input.email],
            emailAddressIdentificationStatus: ["reserved"],
            externalId: input.key,
            firstName: input.firstName,
            lastName: input.lastName,
            skipPasswordRequirement: true,
          })
      );
      yield* recordWrite?.("user.create", user.id) ?? Effect.void;
    }
    const { primaryEmailAddressId } = user;
    const email = user.emailAddresses.find(
      ({ id }) => id === primaryEmailAddressId
    )?.emailAddress;
    if (
      user.externalId !== input.key ||
      !email ||
      email.toLowerCase() !== input.email.toLowerCase()
    ) {
      return yield* fail();
    }
    return yield* Schema.decodeEffect(ProvisionedAuthUser)({
      email,
      firstName: user.firstName,
      id: user.id,
      key: input.key,
      lastName: user.lastName,
      profilePictureUrl: user.imageUrl ?? null,
    }).pipe(Effect.mapError(fail));
  }),
});
export const authDataProvisionerLayer = Layer.succeed(AuthDataProvisioner, {
  prepare: (provider) =>
    Effect.gen(function* () {
      const target = yield* Config.String(
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
      ).pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider));
      const client = yield* Effect.cached(
        Config.Redacted("CLERK_SECRET_KEY").pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, provider),
          Effect.map(
            (secretKey) =>
              createClerkClient({
                publishableKey: target,
                secretKey: Redacted.value(secretKey),
              }).users
          ),
          Effect.mapError(fail)
        )
      );
      return makeClerkDataProvisioner(`clerk:${target}`, client);
    }).pipe(Effect.mapError(fail)),
});
