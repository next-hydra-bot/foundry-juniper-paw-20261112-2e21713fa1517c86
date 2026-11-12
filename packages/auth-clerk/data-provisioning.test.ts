/* oxlint-disable eslint/require-await -- SDK mocks implement asynchronous contracts with immediate deterministic values. */
/* oxlint-disable vitest/max-expects -- This integration scenario verifies one complete provisioning and retry protocol. */
import { PermissionGrant } from "@repo/auth-contract/permissions";
import { AuthUserInput } from "@repo/auth-contract/user-input";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeClerkDataProvisioner } from "./data-provisioning";
import type {
  ClerkProvisioningUsers,
  ClerkProvisioningMetadata,
} from "./data-provisioning";

describe("Clerk setup data", () => {
  it("owns users by external key, creates unverified passwordless profiles and preserves other scopes", async () => {
    const input = Schema.decodeSync(AuthUserInput)({
      email: "buyer@example.com",
      key: "buyer",
    });
    let exists = false;
    let metadata: ClerkProvisioningMetadata = {
      application_permissions: {
        grants: [
          {
            permissions: ["existing.permission"],
            scope: { id: "other-unit", type: "business-unit" },
          },
        ],
        version: 1,
      },
      unrelated: "keep",
    };
    const user = () => ({
      emailAddresses: [{ emailAddress: input.email, id: "email-1" }],
      externalId: "buyer",
      firstName: null,
      id: "clerk-user-1",
      imageUrl: "",
      lastName: null,
      primaryEmailAddressId: "email-1",
      publicMetadata: metadata,
    });
    const writes: Parameters<ClerkProvisioningUsers["createUser"]>[0][] = [];
    const users: ClerkProvisioningUsers = {
      createUser: async (value) => {
        writes.push(value);
        exists = true;
        return user();
      },
      getUser: async () => user(),
      getUserList: async (query) => {
        expect(query?.externalId).toEqual(["buyer"]);
        return {
          data: exists ? [user()] : [],
          totalCount: exists ? 1 : 0,
        };
      },
      updateUser: async () => user(),
      updateUserMetadata: async (_, value) => {
        metadata = { ...metadata, ...value.publicMetadata };
        return user();
      },
    };
    const adapter = makeClerkDataProvisioner(
      "test-instance",
      Effect.succeed(users)
    );
    await Effect.runPromise(adapter.upsertUser(input));
    await Effect.runPromise(adapter.upsertUser(input));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      emailAddressIdentificationStatus: ["reserved"],
      externalId: "buyer",
      skipPasswordRequirement: true,
    });
    expect(writes[0]).not.toHaveProperty("password");
    const grant = Schema.decodeSync(PermissionGrant)({
      authUserId: "clerk-user-1",
      permissions: ["company.members.invite"],
      scope: { id: "unit-1", type: "business-unit" },
    });
    await Effect.runPromise(adapter.setGrant(grant));
    await Effect.runPromise(adapter.setGrant(grant));
    expect(metadata).toMatchObject({
      application_permissions: {
        grants: [
          { scope: { id: "other-unit" } },
          { permissions: ["company.members.invite"], scope: { id: "unit-1" } },
        ],
      },
      unrelated: "keep",
    });
    await expect(
      Effect.runPromise(
        adapter
          .setGrant({ ...grant, scope: { id: "admin", type: "organization" } })
          .pipe(Effect.isFailure)
      )
    ).resolves.toBeTruthy();
  });

  it("rejects an external-key result with another key rather than adopting an email match", async () => {
    const adapter = makeClerkDataProvisioner(
      "test",
      Effect.succeed({
        createUser: () => {
          throw new Error("unexpected");
        },
        getUser: () => {
          throw new Error("unexpected");
        },
        getUserList: async () => ({
          data: [
            {
              emailAddresses: [],
              externalId: "other",
              firstName: null,
              id: "other",
              lastName: null,
              primaryEmailAddressId: null,
              publicMetadata: {},
            },
          ],
          totalCount: 1,
        }),
        updateUser: () => {
          throw new Error("unexpected");
        },
        updateUserMetadata: () => {
          throw new Error("unexpected");
        },
      })
    );
    const input = Schema.decodeSync(AuthUserInput)({
      email: "buyer@example.com",
      key: "buyer",
    });
    await expect(
      Effect.runPromise(adapter.upsertUser(input).pipe(Effect.isFailure))
    ).resolves.toBeTruthy();
  });
});
