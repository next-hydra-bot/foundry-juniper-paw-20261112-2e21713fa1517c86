import { Effect, Schema } from "effect";

class SignOutFailure extends Schema.TaggedError<SignOutFailure>()(
  "SignOutFailure",
  {
    reason: Schema.Literals(["unavailable", "sessionChanged"]),
  }
) {}

/** Read the active session again after preparation so an account switch cannot sign out its replacement. */
export const signOutWithPreparation = Effect.fn("Clerk.signOutWithPreparation")(
  function* (options: {
    readonly prepare: () => Promise<void>;
    readonly readSessionId: () => string | undefined;
    readonly redirectUrl: string;
    readonly signOut: (input: {
      readonly sessionId: string;
      readonly redirectUrl: string;
    }) => Promise<void>;
  }) {
    const sessionId = options.readSessionId();
    if (!sessionId) {
      return yield* new SignOutFailure({ reason: "sessionChanged" });
    }
    yield* Effect.tryPromise({
      try: options.prepare,
      catch: () => new SignOutFailure({ reason: "unavailable" }),
    });
    if (options.readSessionId() !== sessionId) {
      return yield* new SignOutFailure({ reason: "sessionChanged" });
    }
    yield* Effect.tryPromise({
      try: async () => {
        await options.signOut({ sessionId, redirectUrl: options.redirectUrl });
      },
      catch: () => new SignOutFailure({ reason: "unavailable" }),
    });
  }
);
