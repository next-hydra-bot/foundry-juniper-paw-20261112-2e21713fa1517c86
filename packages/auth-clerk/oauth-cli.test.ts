import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  ConfigProvider,
  Console,
  Effect,
  Exit,
  FileSystem,
  Path,
  PlatformError,
  Schema,
} from "effect";
import { CliConfig, Command, GlobalFlag } from "effect/cli";
import { afterEach, vi } from "vitest";

import { createAuthCommand } from "./cli";

const errorMessage = Schema.decodeUnknownEffect(
  Schema.Struct({ userMessage: Schema.String })
);

describe("Clerk OAuth CLI composition", () => {
  afterEach(() => vi.restoreAllMocks());
  it.effect(
    "identifies a missing customer Clerk key without making a remote request",
    () =>
      Effect.gen(function* () {
        const request = vi
          .spyOn(globalThis, "fetch")
          .mockRejectedValue(new Error("Unexpected API request"));
        const error = yield* Command.runWith(
          createAuthCommand(Effect.succeed(ConfigProvider.fromUnknown({}))),
          { version: "0.0.0" }
        )(["oauth", "provision", "--yes"]).pipe(
          Effect.provide(NodeServices.layer),
          Effect.flip
        );
        expect((yield* errorMessage(error)).userMessage).toContain(
          "CLERK_SECRET_KEY"
        );
        expect(request).not.toHaveBeenCalled();
      })
  );
  it.effect(
    "identifies an unreadable bootstrap file without including its contents",
    () =>
      Effect.gen(function* () {
        const error = yield* Command.runWith(
          createAuthCommand(
            Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                cause: new Error("private-bootstrap-content"),
                method: "readFile",
                module: "FileSystem",
                pathOrDescriptor: "/missing/.env.bootstrap.local",
              })
            )
          ),
          { version: "0.0.0" }
        )(["oauth", "provision", "--yes"]).pipe(
          Effect.provide(NodeServices.layer),
          Effect.flip
        );
        expect((yield* errorMessage(error)).userMessage).toContain(
          "/missing/.env.bootstrap.local"
        );
        expect(String(error)).not.toContain("private-bootstrap-content");
      })
  );
  it.effect(
    "identifies an unavailable output directory before any API request",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: "clerk-oauth-cli-",
        });
        const outputDirectory = path.join(directory, "missing");
        const request = vi
          .spyOn(globalThis, "fetch")
          .mockRejectedValue(new Error("Unexpected API request"));
        const error = yield* Command.runWith(
          createAuthCommand(
            Effect.succeed(
              ConfigProvider.fromUnknown({
                CLERK_SECRET_KEY: "clerk-private-key",
              })
            )
          ),
          { version: "0.0.0" }
        )([
          "oauth",
          "provision",
          "--yes",
          "--output",
          path.join(outputDirectory, "private.env"),
        ]).pipe(Effect.flip);
        expect((yield* errorMessage(error)).userMessage).toContain(
          outputDirectory
        );
        expect(request).not.toHaveBeenCalled();
        expect(String(error)).not.toContain("clerk-private-key");
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
  );
  for (const [arguments_, expectedFlag] of [
    [["oauth", "provision", "--help"], "--redirect-uri"],
    [["provision", "--help"], "--api-url"],
    [["claims", "provision", "--help"], "--dry-run"],
  ] as const) {
    it.effect(
      `retains ${arguments_.join(" ")} without resolving credentials`,
      () =>
        Effect.gen(function* () {
          const output: string[] = [];
          const logger: Console.Console = {
            ...console,
            log: (...values: readonly unknown[]) => {
              output.push(values.join(" "));
            },
          };
          const result = yield* Command.runWith(
            createAuthCommand(Effect.die("Help must not resolve credentials")),
            { version: "0.0.0" }
          )(arguments_).pipe(
            Effect.provideService(
              CliConfig.CliConfig,
              CliConfig.make({ builtIns: [GlobalFlag.Help] })
            ),
            Effect.provideService(Console.Console, logger),
            Effect.provide(NodeServices.layer),
            Effect.exit
          );
          expect(Exit.isSuccess(result)).toBeTruthy();
          expect(output.join("\n")).toContain(expectedFlag);
        })
    );
  }
});
