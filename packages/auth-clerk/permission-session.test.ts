import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  ClerkPermissionSession,
  clerkPermissionSessionLayerWith,
} from "./permissions";
import type {
  ClerkPermissionSessionReader,
  ClerkPermissionSessionSource,
} from "./permissions";

const session = {
  has: () => false,
  isAuthenticated: true,
  orgId: null,
  sessionClaims: { app_permissions: { grants: [], version: 1 }, sub: "alice" },
  userId: "alice",
} satisfies ClerkPermissionSessionSource;

const read = (reader: ClerkPermissionSessionReader) =>
  ClerkPermissionSession.pipe(
    Effect.flatMap((source) => source.read),
    Effect.provide(clerkPermissionSessionLayerWith(reader))
  );

const has = ({ permission }: { readonly permission: string }) =>
  permission === "org:members:invite";

describe("Clerk permission session", () => {
  it("uses verified claims and the SDK's normalized organization and checker", async () => {
    await expect(
      Effect.runPromise(
        read({
          readSession: async () =>
            await Promise.resolve({
              ...session,
              has,
              orgId: "org-admin",
            }),
        })
      )
    ).resolves.toMatchObject({
      claims: { app_permissions: { grants: [], version: 1 }, sub: "alice" },
      has,
      organizationId: "org-admin",
    });
  });

  it("does not require an organization for a customer session", async () => {
    await expect(
      Effect.runPromise(
        read({ readSession: async () => await Promise.resolve(session) })
      )
    ).resolves.toMatchObject({
      claims: { sub: "alice" },
      organizationId: undefined,
    });
  });

  it("denies unauthenticated or pending sessions", async () => {
    await expect(
      Effect.runPromise(
        read({
          readSession: async () =>
            await Promise.resolve({ isAuthenticated: false }),
        })
      )
    ).resolves.toBeUndefined();
  });

  it.each([{ sub: "bob" }, {}, { sub: "" }, null])(
    "rejects invalid or mismatched authenticated claims: %j",
    async (sessionClaims) => {
      await expect(
        Effect.runPromise(
          read({
            readSession: async () =>
              await Promise.resolve({ ...session, sessionClaims }),
          }).pipe(Effect.flip)
        )
      ).resolves.toMatchObject({ reason: "invalidGrant" });
    }
  );

  it("preserves reader failures", async () => {
    await expect(
      Effect.runPromise(
        read({
          readSession: async () =>
            await Promise.reject(new Error("Clerk unavailable")),
        }).pipe(Effect.flip)
      )
    ).resolves.toMatchObject({ reason: "unavailable" });
  });

  it("reads the active session on every execution", async () => {
    let current: ClerkPermissionSessionSource = session;
    let reads = 0;
    const effect = read({
      readSession: async () => {
        reads += 1;
        return await Promise.resolve(current);
      },
    });
    expect(reads).toBe(0);
    await expect(Effect.runPromise(effect)).resolves.toMatchObject({
      claims: { sub: "alice" },
    });
    current = { isAuthenticated: false };
    await expect(Effect.runPromise(effect)).resolves.toBeUndefined();
    expect(reads).toBe(2);
  });
});
