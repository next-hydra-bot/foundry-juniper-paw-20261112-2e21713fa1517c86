import { Context, Schema } from "effect";
import type { Effect } from "effect";

/** Provider-verified impersonation facts. Email is not an immutable staff ID. */
export const SessionActor = Schema.Struct({
  claims: Schema.Record(Schema.String, Schema.Json),
  email: Schema.optional(Schema.NonEmptyString),
  provider: Schema.NonEmptyString,
  reason: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.NonEmptyString),
}).check(
  Schema.makeFilter(
    (actor) => actor.subject !== undefined || actor.email !== undefined
  )
);
export type SessionActor = typeof SessionActor.Type;

export class ImpersonationRecordingFailure extends Schema.TaggedError<ImpersonationRecordingFailure>()(
  "ImpersonationRecordingFailure",
  {
    reason: Schema.Literals(["unavailable", "invalidData"]),
  }
) {}
/** An archive owns retention and idempotency by provider/session ID. Observation is not session creation. */
export class ImpersonationRecorder extends Context.Service<
  ImpersonationRecorder,
  {
    readonly observe: (observation: {
      readonly actor: SessionActor;
      readonly sessionId: string;
      readonly userId: string;
    }) => Effect.Effect<void, ImpersonationRecordingFailure>;
  }
>()("@repo/auth/ImpersonationRecorder") {}
