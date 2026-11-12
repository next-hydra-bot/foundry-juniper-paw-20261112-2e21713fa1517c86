import { makeSessionClaimsHttp } from "@repo/auth-contract/session-claims-http";
import {
  planSessionClaims,
  SessionClaimsProvisioner,
  SessionClaimsProvisioningError,
} from "@repo/auth-contract/session-claims-provisioning";
import { Config, ConfigProvider, Effect, Layer, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const Claims = Schema.Record(Schema.String, Schema.Json);
const sameClaims = Schema.toEquivalence(Claims);
const Applications = Schema.Array(
  Schema.Struct({
    application_id: Schema.NonEmptyString,
    instances: Schema.Array(
      Schema.Struct({ instance_id: Schema.NonEmptyString })
    ),
  })
);
const SessionConfig = Schema.Struct({
  session: Schema.NullOr(
    Schema.Struct({
      claims: Schema.optionalKey(Schema.NullOr(Claims)),
    })
  ),
});
const SessionConfigSchema = Schema.Struct({
  properties: Schema.Struct({
    session: Schema.Struct({
      properties: Schema.Struct({
        claims: Schema.Struct({ type: Schema.Literal("object") }),
      }),
    }),
  }),
});
const failure = (message: string) =>
  new SessionClaimsProvisioningError({ message });

export interface ClerkClaimsCommand {
  readonly run: (
    args: readonly string[],
    input?: Readonly<Record<string, Schema.Json>>
  ) => Effect.Effect<string, SessionClaimsProvisioningError>;
}

/** The CLI owns account authentication and token refresh; credentials never enter arguments or output. */
export const makeClerkClaimsCommand = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]
): ClerkClaimsCommand => ({
  run: Effect.fn("ClerkSessionClaims.command")((args, input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(
            "npx",
            ["--yes", "clerk@4.1.0", "--mode", "agent", ...args],
            {
              env: {
                CLERK_PLATFORM_API_KEY: undefined,
                CLERK_SECRET_KEY: undefined,
                CLERK_TELEMETRY_DISABLED: "1",
                NO_COLOR: "1",
              },
              extendEnv: true,
              stderr: "pipe",
              stdin:
                input === undefined
                  ? "ignore"
                  : Stream.make(
                      new TextEncoder().encode(JSON.stringify(input))
                    ),
              stdout: "pipe",
            }
          )
        );
        const result = yield* Effect.all(
          {
            exitCode: handle.exitCode,
            stderr: Stream.runDrain(handle.stderr),
            stdout: Stream.decodeText(handle.stdout).pipe(Stream.mkString),
          },
          { concurrency: "unbounded" }
        );
        if (result.exitCode !== 0) {
          return yield* failure(
            `Clerk CLI ${args[0]} ${args[1]} failed (exit ${result.exitCode}). Run npx clerk@4.1.0 auth login and verify access to the customer application. Read the current session template before retrying a failed patch.`
          );
        }
        return result.stdout;
      })
    ).pipe(
      Effect.timeout("60 seconds"),
      Effect.mapError((error) =>
        Schema.is(SessionClaimsProvisioningError)(error)
          ? error
          : failure(
              "Could not run the Clerk CLI. Ensure npx is available and run npx clerk@4.1.0 auth login."
            )
      )
    )
  ),
});

export const makeClerkSessionClaimsProvisioner = (client: {
  readonly instanceId: Effect.Effect<string, SessionClaimsProvisioningError>;
  readonly command: ClerkClaimsCommand;
}): SessionClaimsProvisioner["Service"] => {
  const decodeJson = <
    S extends Schema.Top & { readonly DecodingServices: never },
  >(
    schema: S,
    text: string
  ) =>
    Schema.decodeEffect(Schema.fromJsonString(schema))(text).pipe(
      Effect.mapError(() =>
        failure(
          "Clerk returned an invalid customer configuration response. No success was reported."
        )
      )
    );
  return SessionClaimsProvisioner.of({
    provision: Effect.fn("ClerkSessionClaims.provision")(function* ({
      definitions,
      dryRun,
    }) {
      const instanceId = yield* client.instanceId;
      const apps = yield* decodeJson(
        Applications,
        yield* client.command.run(["apps", "list", "--json"])
      );
      const matches = apps.filter((app) =>
        app.instances.some((instance) => instance.instance_id === instanceId)
      );
      const [app] = matches;
      if (matches.length !== 1 || app === undefined) {
        return yield* failure(
          "The Clerk CLI account cannot uniquely access the instance identified by CLERK_SECRET_KEY. Sign in to the customer application's workspace; no configuration was changed."
        );
      }
      const targetArgs = [
        "--app",
        app.application_id,
        "--instance",
        instanceId,
      ];
      yield* decodeJson(
        SessionConfigSchema,
        yield* client.command.run([
          "config",
          "schema",
          ...targetArgs,
          "--keys",
          "session",
        ])
      );
      const read = () =>
        client.command
          .run(["config", "pull", ...targetArgs, "--keys", "session"])
          .pipe(
            Effect.flatMap((text) => decodeJson(SessionConfig, text)),
            Effect.map((config) => config.session?.claims ?? {})
          );
      const current = yield* read();
      const plan = yield* planSessionClaims(
        Object.fromEntries(
          Object.entries(current).map(([name, value]) => [
            name,
            JSON.stringify(value),
          ])
        ),
        definitions,
        (key) => JSON.stringify(`{{user.public_metadata.${key}}}`)
      );
      const receipt = {
        claims: plan.claims,
        removed: plan.removed,
        target: `Clerk customer instance ${instanceId}`,
      };
      if (!plan.changed) {
        return { ...receipt, action: "unchanged" as const };
      }
      const expected = Object.fromEntries(
        yield* Effect.forEach(Object.entries(plan.next), ([name, value]) =>
          decodeJson(Schema.Json, value).pipe(
            Effect.map((decoded) => [name, decoded] as const)
          )
        )
      );
      // Native PATCH merges claims. Null removes a superseded key; omitted fields remain untouched.
      const patch = Object.fromEntries([
        ...Object.entries(expected).filter(([name]) =>
          plan.claims.includes(name)
        ),
        ...plan.removed.map((name) => [name, null] as const),
      ]);
      yield* client.command.run(
        [
          "config",
          "patch",
          ...targetArgs,
          "--yes",
          ...(dryRun ? ["--dry-run"] : []),
        ],
        { session: { claims: patch } }
      );
      const saved = yield* read();
      if (!sameClaims(saved, dryRun ? current : expected)) {
        return yield* failure(
          dryRun
            ? "Clerk session claims changed during the dry run. Inspect the customer session template before retrying."
            : "Clerk did not retain the requested session claims. Inspect the customer session template before retrying."
        );
      }
      return {
        ...receipt,
        action: dryRun ? ("planned" as const) : ("updated" as const),
      };
    }),
  });
};

export const createClerkSessionClaimsLayer = <E, R>(
  provider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  Layer.effect(
    SessionClaimsProvisioner,
    Effect.gen(function* () {
      const key = yield* Config.schema(
        Schema.RedactedFromValue(Schema.NonEmptyString),
        "CLERK_SECRET_KEY"
      );
      const request = makeSessionClaimsHttp("https://api.clerk.com/v1", key);
      const instanceId = request("GET", "/instance").pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({ id: Schema.NonEmptyString })
          )
        ),
        Effect.map((instance) => instance.id),
        Effect.mapError(() =>
          failure(
            "Could not identify the customer Clerk instance. Check CLERK_SECRET_KEY in the input env file."
          )
        )
      );
      return makeClerkSessionClaimsProvisioner({
        command: makeClerkClaimsCommand(
          yield* ChildProcessSpawner.ChildProcessSpawner
        ),
        instanceId,
      });
    })
  ).pipe(Layer.provide(ConfigProvider.layer(provider)));
