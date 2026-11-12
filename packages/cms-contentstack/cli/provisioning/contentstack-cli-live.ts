import { getContentstackEndpoint } from "@contentstack/utils";
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Redacted,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import packageManifest from "../../package.json" with { type: "json" };
import { ContentstackCli } from "./contentstack-cli";
import {
  ContentstackCliError,
  ContentstackRuntimeEndpoints,
  ContentstackStack,
} from "./model";

export const CONTENTSTACK_CLI_VERSION =
  packageManifest.dependencies["@contentstack/cli"];

const TokenAlias = Schema.Struct({
  alias: Schema.NonEmptyString,
  apiKey: Schema.NonEmptyString,
  token: Schema.RedactedFromValue(Schema.NonEmptyString, {
    label: "Contentstack Management Token",
  }),
  type: Schema.NonEmptyString,
});

const TokenAliases = Schema.Array(TokenAlias);

// CSDX 2.0.0 catches registration errors and can exit 0 without saving a token.
// Never include its output in errors: it may contain credentials.
export const registrationSucceeded = (stdout: string) =>
  /Successfully (?:added|replaced) the token/.test(stdout);

export const noRegisteredTokens = (stdout: string) =>
  stdout.includes("No tokens are added. Use auth:tokens:add command to add tokens.");
const CONFIGURED_REGION_PATTERN =
  /Currently using the '(?<region>[^']+)' region\./u;
const decodeEndpoint = Schema.decodeUnknownSync(Schema.NonEmptyString);

const cliError = (
  operation: ContentstackCliError["operation"],
  message: string,
  cause: unknown
) => new ContentstackCliError({ cause, message, operation });

const runCommand = Effect.fn("ContentstackCli.runCommand")(function* (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  command: ChildProcess.Command,
  operation: ContentstackCliError["operation"],
  message: string,
  readOutput = false
) {
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);
      return yield* Effect.all(
        {
          exitCode: handle.exitCode,
          stderr: Stream.runDrain(handle.stderr),
          stdout: readOutput
            ? Stream.mkString(Stream.decodeText(handle.stdout))
            : Effect.as(Stream.runDrain(handle.stdout), ""),
        },
        { concurrency: "unbounded" }
      );
    })
  ).pipe(
    Effect.mapError(() =>
      cliError(
        operation,
        message,
        new Error("Could not run the Contentstack CLI")
      )
    )
  );

  if (result.exitCode !== 0) {
    return yield* cliError(
      operation,
      message,
      new Error(`Contentstack CLI exited with code ${result.exitCode}`)
    );
  }

  return result;
});

const contentstackEndpoint = Effect.fn("ContentstackCli.endpoint")(function* (
  region: string,
  service: "graphqlDelivery" | "graphqlPreview"
) {
  return yield* Effect.try({
    catch: (cause) =>
      cliError(
        "region",
        `Could not resolve the ${service} endpoint for Contentstack region ${region}`,
        cause
      ),
    try: () => decodeEndpoint(getContentstackEndpoint(region, service, true)),
  });
});

export const contentstackCliLayer = Layer.effect(
  ContentstackCli,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const configProvider = yield* ConfigProvider.ConfigProvider;
    const fileSystem = yield* FileSystem.FileSystem;
    const executableUrl = yield* Effect.try({
      catch: (cause) =>
        cliError(
          "version",
          "Could not locate the pinned Contentstack CLI",
          cause
        ),
      try: () => new URL(import.meta.resolve("@contentstack/cli/bin/run.js")),
    });
    const executable = yield* path.fromFileUrl(executableUrl);

    function invoke(
      args: readonly string[],
      operation: ContentstackCliError["operation"],
      message: string,
      options?: { readOutput?: boolean; token?: string }
    ) {
      return Effect.scoped(
        fileSystem
          .makeTempDirectoryScoped({ prefix: "contentstack-cli-" })
          .pipe(
            Effect.mapError(() =>
              cliError(
                operation,
                message,
                new Error("Private temporary directory unavailable")
              )
            ),
            Effect.flatMap((cwd) =>
              runCommand(
                spawner,
                ChildProcess.make(process.execPath, [executable, ...args], {
                  cwd,
                  extendEnv: true,
                  env: { CS_CLI_LOG_PATH: cwd, TOKEN: options?.token },
                  stderr: "pipe",
                  stdin: "ignore",
                  stdout: "pipe",
                }),
                operation,
                message,
                options?.readOutput
              )
            )
          )
      );
    }

    return ContentstackCli.of({
      importRecipe: Effect.fn("ContentstackCli.importRecipeLive")(
        function* (options) {
          // The patched importer exits nonzero on validation or import errors.
          yield* invoke(
            [
              "cm:stacks:import",
              "--alias",
              options.managementTokenAlias,
              "--data-dir",
              options.directory,
              "--yes",
              "--import-webhook-status",
              "disable",
            ],
            "import",
            "Contentstack could not import the starter recipe"
          );
        }
      ),
      resolveStack: Effect.fn("ContentstackCli.resolveStack")(
        function* (managementTokenAlias) {
          const aliasError = (reason: string) =>
            cliError(
              "resolveAlias",
              "Could not prepare the Contentstack Management Token alias",
              new Error(reason)
            );
          const suppliedToken = yield* Config.option(
            Config.Redacted("CONTENTSTACK_MANAGEMENT_TOKEN")
          ).pipe(
            Effect.mapError(() =>
              aliasError("Invalid private management credentials")
            )
          );
          let expectedApiKey: string | undefined;
          if (Option.isSome(suppliedToken)) {
            const { apiKey, region } = yield* Config.all({
              apiKey: Config.String("CONTENTSTACK_STACK_API_KEY"),
              region: Config.String("CONTENTSTACK_REGION"),
            }).pipe(
              Effect.mapError(() =>
                aliasError(
                  "The private management file needs the stack API key and region"
                )
              )
            );
            if (
              !/^blt[A-Za-z0-9]+$/.test(apiKey) ||
              managementTokenAlias !== `stack-${apiKey}`
            ) {
              return yield* aliasError(
                "Use stack-<stack-api-key> as the alias when supplying a private Management Token"
              );
            }
            const cliRegion = /^(NA|EU|AU)$/.test(region)
              ? `AWS-${region}`
              : region;
            yield* invoke(
              ["config:set:region", cliRegion],
              "region",
              "Could not configure the Contentstack CLI region"
            );
            const registration = yield* invoke(
              [
                "auth:tokens:add",
                "--management",
                "--alias",
                managementTokenAlias,
                "--stack-api-key",
                apiKey,
                "--yes",
              ],
              "resolveAlias",
              "Could not register the Contentstack Management Token",
              { readOutput: true, token: Redacted.value(suppliedToken.value) }
            );
            if (!registrationSucceeded(registration.stdout)) {
              return yield* aliasError(
                "Contentstack CLI did not confirm token registration; check the private management credentials, stack, region and access"
              );
            }
            expectedApiKey = apiKey;
          }
          return yield* invoke(
            [
              "auth:tokens:list",
              "--columns",
              "alias,type,apiKey,token",
              "--filter",
              `alias=${managementTokenAlias}`,
              "--output",
              "json",
            ],
            "resolveAlias",
            `Could not resolve Contentstack Management Token alias ${managementTokenAlias}`,
            { readOutput: true }
          ).pipe(
            Effect.flatMap(({ stdout }) =>
              noRegisteredTokens(stdout)
                ? Effect.fail(
                    aliasError("No Contentstack token aliases are registered")
                  )
                : Schema.decodeEffect(Schema.fromJsonString(TokenAliases))(
                stdout
              ).pipe(
                Effect.mapError(() =>
                  cliError(
                    "resolveAlias",
                    "Could not read the Contentstack token aliases",
                    new Error("Unrecognized alias response")
                  )
                )
              )
            ),
            Effect.flatMap((aliases) => {
              const match = aliases.find(
                (candidate) => candidate.alias === managementTokenAlias
              );

              if (
                match === undefined ||
                (expectedApiKey !== undefined &&
                  match.apiKey !== expectedApiKey) ||
                (Option.isSome(suppliedToken) &&
                  Redacted.value(match.token) !==
                    Redacted.value(suppliedToken.value))
              ) {
                return Effect.fail(
                  cliError(
                    "resolveAlias",
                    `Could not resolve Contentstack Management Token alias ${managementTokenAlias}`,
                    new Error(
                      "The alias did not resolve to the expected Management Token"
                    )
                  )
                );
              }

              if (match.type !== "management") {
                return Effect.fail(
                  cliError(
                    "resolveAlias",
                    `Could not resolve Contentstack Management Token alias ${managementTokenAlias}`,
                    new Error(
                      `Contentstack token alias ${managementTokenAlias} is ${match.type}, not management`
                    )
                  )
                );
              }

              return Schema.decodeEffect(ContentstackStack)({
                apiKey: match.apiKey,
                managementToken: match.token,
                managementTokenAlias,
              }).pipe(
                Effect.mapError((cause) =>
                  cliError(
                    "resolveAlias",
                    `Could not resolve Contentstack Management Token alias ${managementTokenAlias}`,
                    cause
                  )
                )
              );
            }),
            Effect.mapError((cause) =>
              Schema.is(ContentstackCliError)(cause)
                ? cause
                : cliError(
                    "resolveAlias",
                    `Could not resolve Contentstack Management Token alias ${managementTokenAlias}`,
                    cause
                  )
            )
          );
        },
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider)
      ),
      runMigration: Effect.fn("ContentstackCli.runMigrationLive")(
        function* (options) {
          yield* invoke(
            [
              "cm:stacks:migration",
              "--alias",
              options.managementTokenAlias,
              "--file-path",
              options.file,
            ],
            "migrate",
            `Contentstack could not apply migration ${options.file}`
          );
        }
      ),
      runtimeEndpoints: Effect.fn("ContentstackCli.runtimeEndpoints")(
        function* () {
          const output = yield* invoke(
            ["config:get:region"],
            "region",
            "Could not read the configured Contentstack CLI region",
            { readOutput: true }
          );
          const region = CONFIGURED_REGION_PATTERN.exec(output.stdout)?.groups
            ?.region;

          if (region === undefined) {
            return yield* cliError(
              "region",
              "Could not read the configured Contentstack CLI region",
              new Error("Contentstack CLI region output was not recognized")
            );
          }

          const graphqlHost = yield* contentstackEndpoint(
            region,
            "graphqlDelivery"
          );
          const graphqlPreviewHost = yield* contentstackEndpoint(
            region,
            "graphqlPreview"
          );

          return new ContentstackRuntimeEndpoints({
            graphqlHost,
            graphqlPreviewHost,
            region,
          });
        }
      ),
      version: Effect.fn("ContentstackCli.version")(function* () {
        const output = yield* invoke(
          ["--version"],
          "version",
          "Could not run the pinned Contentstack CLI",
          { readOutput: true }
        );
        return output.stdout.trim();
      }),
    });
  }).pipe(
    Effect.mapError((cause) =>
      cliError("version", "Could not locate the pinned Contentstack CLI", cause)
    )
  )
);
