import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { signOutWithPreparation } from "./sign-out";

describe("prepared Clerk sign-out", () => {
  it.effect(
    "captures commerce logout before ending the exact site session",
    () =>
      Effect.gen(function* () {
        const order: string[] = [];
        const calls: { sessionId: string; redirectUrl: string }[] = [];
        yield* signOutWithPreparation({
          prepare: async () => {
            order.push("commerce");
            await Promise.resolve();
          },
          readSessionId: () => "session-a",
          redirectUrl: "/account/logout/continue",
          signOut: async (input) => {
            order.push("clerk");
            calls.push(input);
            await Promise.resolve();
          },
        });
        expect(order).toEqual(["commerce", "clerk"]);
        expect(calls).toEqual([
          { sessionId: "session-a", redirectUrl: "/account/logout/continue" },
        ]);
      })
  );

  it.effect("does not sign out a replacement account", () =>
    Effect.gen(function* () {
      let sessionId = "session-a";
      let signedOut = false;
      const error = yield* signOutWithPreparation({
        prepare: async () => {
          sessionId = "session-b";
          await Promise.resolve();
        },
        readSessionId: () => sessionId,
        redirectUrl: "/account/logout/continue",
        signOut: async () => {
          signedOut = true;
          await Promise.resolve();
        },
      }).pipe(Effect.flip);
      expect(error.reason).toBe("sessionChanged");
      expect(signedOut).toBeFalsy();
    })
  );

  it.effect("keeps site authentication when preparation fails", () =>
    Effect.gen(function* () {
      let signedOut = false;
      const error = yield* signOutWithPreparation({
        prepare: async () => {
          await Promise.reject(new Error("Unavailable"));
        },
        readSessionId: () => "session-a",
        redirectUrl: "/account/logout/continue",
        signOut: async () => {
          signedOut = true;
          await Promise.resolve();
        },
      }).pipe(Effect.flip);
      expect(error.reason).toBe("unavailable");
      expect(signedOut).toBeFalsy();
    })
  );

  it.effect("never invokes global Clerk logout without an active session", () =>
    Effect.gen(function* () {
      let signedOut = false;
      const error = yield* signOutWithPreparation({
        prepare: async () => {
          await Promise.resolve();
        },
        readSessionId: () => undefined,
        redirectUrl: "/account/logout/continue",
        signOut: async () => {
          signedOut = true;
          await Promise.resolve();
        },
      }).pipe(Effect.flip);
      expect(error.reason).toBe("sessionChanged");
      expect(signedOut).toBeFalsy();
    })
  );
});
