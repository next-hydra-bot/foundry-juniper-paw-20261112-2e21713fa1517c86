import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";

import { ContentstackCli } from "./contentstack-cli";
import {
  contentstackCliLayer,
  noRegisteredTokens,
  registrationSucceeded,
} from "./contentstack-cli-live";

describe("Contentstack CLI diagnostics", () => {
  it.effect(
    "reports the subprocess exit status without including its raw diagnostics",
    () => {
      const encoder = new TextEncoder();
      const spawnerLayer = Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make(() =>
          Effect.succeed(
            ChildProcessSpawner.makeHandle({
              all: Stream.empty,
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)),
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              pid: ChildProcessSpawner.ProcessId(1),
              stderr: Stream.make(encoder.encode("migration stderr\n")),
              stdin: Sink.drain,
              stdout: Stream.make(encoder.encode("migration stdout\n")),
              unref: Effect.succeed(Effect.void),
            })
          )
        )
      );
      const layer = contentstackCliLayer.pipe(
        Layer.provide(
          Layer.mergeAll(NodePath.layer, NodeFileSystem.layer, spawnerLayer)
        )
      );

      return Effect.gen(function* () {
        const cli = yield* ContentstackCli;

        const error = yield* Effect.flip(
          cli.runMigration({
            file: "migration.js",
            managementTokenAlias: "management-token",
          })
        );
        expect(error.operation).toBe("migrate");
        expect(error.cause).toEqual(
          new Error("Contentstack CLI exited with code 1")
        );
      }).pipe(Effect.provide(layer));
    }
  );
});


describe("Contentstack CLI 2.0.0 token output", () => {
  it("requires a registration success message rather than trusting exit status", () => {
    expect(registrationSucceeded("Successfully added the token\n")).toBe(true);
    expect(registrationSucceeded("Successfully replaced the token\n")).toBe(true);
    expect(registrationSucceeded("Failed to add the token\nprivate diagnostic")).toBe(false);
    expect(registrationSucceeded("")).toBe(false);
  });

  it("recognizes the non-JSON empty-token response", () => {
    expect(noRegisteredTokens("No tokens are added. Use auth:tokens:add command to add tokens.\n")).toBe(true);
    expect(noRegisteredTokens("[]")).toBe(false);
  });
});


describe("Contentstack CLI configuration scope", () => {
  it.effect("uses the layer's private provider when resolveStack runs later", () => {
    const outputs = [
      "region configured",
      "Successfully added the token",
      JSON.stringify([{ alias: "stack-bltExample", apiKey: "bltExample", token: "synthetic-token", type: "management" }]),
    ];
    let calls = 0;
    const encoder = new TextEncoder();
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => {
        const output = outputs[calls++] ?? "unexpected invocation";
        return Effect.succeed(ChildProcessSpawner.makeHandle({
          all: Stream.empty,
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          pid: ChildProcessSpawner.ProcessId(1),
          stderr: Stream.empty,
          stdin: Sink.drain,
          stdout: Stream.make(encoder.encode(output)),
          unref: Effect.succeed(Effect.void),
        }));
      })
    );
    const provider = ConfigProvider.fromUnknown({
      CONTENTSTACK_STACK_API_KEY: "bltExample",
      CONTENTSTACK_REGION: "NA",
      CONTENTSTACK_MANAGEMENT_TOKEN: "synthetic-token",
    });
    const layer = contentstackCliLayer.pipe(
      Layer.provide(ConfigProvider.layer(Effect.succeed(provider))),
      Layer.provide(Layer.mergeAll(NodePath.layer, NodeFileSystem.layer, spawnerLayer))
    );
    return Effect.gen(function* () {
      const cli = yield* ContentstackCli;
      const stack = yield* cli.resolveStack("stack-bltExample").pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({}))
      );
      expect(stack.apiKey).toBe("bltExample");
      expect(Redacted.value(stack.managementToken)).toBe("synthetic-token");
      expect(calls).toBe(3);
    }).pipe(Effect.provide(layer));
  });
});
