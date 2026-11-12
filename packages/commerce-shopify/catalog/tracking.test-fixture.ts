import { Effect, Layer, Schema } from "effect";
import { Tracking } from "migrate-sdk";

// These tests exercise the native requests directly. The CLI runner supplies
// Tracking in production, where it persists the same encoded changes.
export const testTracking = Layer.succeed(Tracking, {
  logDiagnostic: ({ details, message, severity }) =>
    Effect.succeed({
      details,
      kind: "diagnostic",
      message,
      sequence: 0,
      severity,
    }),
  recordChange: (descriptor, value) =>
    Schema.encodeEffect(descriptor.schema)(value).pipe(
      Effect.as({
        descriptorId: descriptor.id,
        kind: "change",
        sequence: 0,
        value,
      })
    ),
  removeExtension: () => Effect.void,
  setExtension: () => Effect.void,
  setRecord: () => Effect.void,
});
