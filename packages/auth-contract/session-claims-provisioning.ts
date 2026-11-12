import { Context, Effect, Schema } from "effect";

/** Features name the metadata they need; identity providers own template syntax. */
export const SessionClaimDefinition = Schema.Struct({
  metadataKey: Schema.String.check(
    Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  ),
  name: Schema.NonEmptyString,
  replaces: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
});
export type SessionClaimDefinition = typeof SessionClaimDefinition.Type;

/** Scoped roles are an auth document, independent of each domain's permission policy. */
export const scopedRoleSessionClaims = [
  {
    metadataKey: "application_roles",
    name: "app_roles",
    replaces: ["app_permissions"],
  },
] as const satisfies readonly SessionClaimDefinition[];

export class SessionClaimsProvisioningError extends Schema.TaggedError<SessionClaimsProvisioningError>()(
  "SessionClaimsProvisioningError",
  { message: Schema.String }
) {}

export interface SessionClaimsReceipt {
  readonly action: "updated" | "unchanged" | "planned";
  readonly claims: readonly string[];
  readonly removed: readonly string[];
  readonly target: string;
}

export class SessionClaimsProvisioner extends Context.Service<
  SessionClaimsProvisioner,
  {
    readonly provision: (input: {
      readonly definitions: readonly SessionClaimDefinition[];
      readonly dryRun: boolean;
    }) => Effect.Effect<SessionClaimsReceipt, SessionClaimsProvisioningError>;
  }
>()("@repo/auth/SessionClaimsProvisioner") {}

/** Values are native JSON/Liquid fragments, kept intact for unrelated claims. */
export const planSessionClaims = (
  current: Readonly<Record<string, string>>,
  definitions: readonly SessionClaimDefinition[],
  render: (metadataKey: string) => string
) =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeEffect(
      Schema.Array(SessionClaimDefinition)
    )(definitions).pipe(
      Effect.mapError(
        () =>
          new SessionClaimsProvisioningError({
            message: "The installed session claim definitions are invalid.",
          })
      )
    );
    const names = new Set(decoded.map((definition) => definition.name));
    const reserved = new Set([
      "sub",
      "iss",
      "aud",
      "exp",
      "iat",
      "nbf",
      "jti",
      "sid",
      "org_id",
    ]);
    if (
      names.size !== decoded.length ||
      decoded.some(
        (definition) =>
          reserved.has(definition.name) ||
          definition.replaces?.some(
            (name) => names.has(name) || reserved.has(name)
          )
      )
    ) {
      return yield* new SessionClaimsProvisioningError({
        message:
          "Session claim definitions conflict or replace reserved claims.",
      });
    }
    const next = new Map(Object.entries(current));
    const removed: string[] = [];
    let changed = false;
    for (const definition of decoded) {
      for (const name of definition.replaces ?? []) {
        if (next.has(name)) {
          next.delete(name);
          removed.push(name);
          changed = true;
        }
      }
      const value = render(definition.metadataKey);
      if (!next.has(definition.name) || next.get(definition.name) !== value) {
        next.set(definition.name, value);
        changed = true;
      }
    }
    return {
      changed,
      claims: [...names],
      next: Object.fromEntries(next),
      removed,
    };
  });
