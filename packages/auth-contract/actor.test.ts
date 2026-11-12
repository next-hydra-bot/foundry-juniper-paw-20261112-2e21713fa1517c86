import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { ImpersonationRecorder, ImpersonationRecordingFailure } from "./actor";
import {
  AuthSession,
  AuthSessionAdapter,
  AuthUser,
  recordedAuthSessionAdapterLayer,
} from "./session";

const session = new AuthSession({
  actor: {
    claims: { reason: "Support case", sub: "staff-1" },
    provider: "test",
    reason: "Support case",
    subject: "staff-1",
  },
  permissions: { has: () => false },
  sessionId: "customer-session-1",
  user: new AuthUser({
    email: null,
    firstName: null,
    id: "customer-1",
    lastName: null,
    profilePictureUrl: null,
  }),
});
describe("Impersonation archive recording", () => {
  it("observes the actual customer session and actor without changing customer authority", async () => {
    const observed: unknown[] = [];
    const layer = recordedAuthSessionAdapterLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AuthSessionAdapter, { read: Effect.succeed(session) }),
          Layer.succeed(ImpersonationRecorder, {
            observe: (value) =>
              Effect.sync(() => {
                observed.push(value);
              }),
          })
        )
      )
    );
    const read = await Effect.runPromise(
      AuthSessionAdapter.read.pipe(Effect.provide(layer))
    );
    expect(observed).toEqual([
      {
        actor: session.actor,
        sessionId: "customer-session-1",
        userId: "customer-1",
      },
    ]);
    expect(read.permissions.has("impersonation.start")).toBeFalsy();
  });

  it("fails the request if the selected recorder cannot retain the observation", async () => {
    const layer = recordedAuthSessionAdapterLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AuthSessionAdapter, { read: Effect.succeed(session) }),
          Layer.succeed(ImpersonationRecorder, {
            observe: () =>
              Effect.fail(
                new ImpersonationRecordingFailure({ reason: "unavailable" })
              ),
          })
        )
      )
    );
    await expect(
      Effect.runPromise(AuthSessionAdapter.read.pipe(Effect.provide(layer)))
    ).rejects.toMatchObject({ _tag: "AuthSessionReadFailure" });
  });

  it("leaves ordinary customer sessions outside the impersonation recorder", async () => {
    const ordinary = new AuthSession({
      permissions: { has: () => false },
      sessionId: "ordinary-session",
      user: session.user,
    });
    const layer = recordedAuthSessionAdapterLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(AuthSessionAdapter, { read: Effect.succeed(ordinary) }),
          Layer.succeed(ImpersonationRecorder, {
            observe: () =>
              Effect.die("Ordinary customers must not enter this recorder"),
          })
        )
      )
    );
    await expect(
      Effect.runPromise(AuthSessionAdapter.read.pipe(Effect.provide(layer)))
    ).resolves.toEqual(ordinary);
  });
});
