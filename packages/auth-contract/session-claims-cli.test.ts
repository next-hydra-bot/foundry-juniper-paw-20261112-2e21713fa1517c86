import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stdio } from "effect";
import { CliConfig, Command, GlobalFlag } from "effect/cli";
import { TestConsole } from "effect/testing";
import { describe, expect, it, vi } from "vitest";

import { makeSessionClaimsCommand } from "./session-claims-cli";
import { SessionClaimsProvisioner } from "./session-claims-provisioning";

const definitions = [{ metadataKey: "application_roles", name: "app_roles" }];
const provide = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        TestConsole.layer,
        Stdio.layerTest({ stdoutIsTerminal: Effect.succeed(false) })
      )
    ),
    Effect.provideService(
      CliConfig.CliConfig,
      CliConfig.make({ builtIns: [GlobalFlag.Help] })
    )
  );

describe("session claim command", () => {
  it("passes only installed feature definitions and plans without confirmation", async () => {
    const provision = vi.fn<SessionClaimsProvisioner["Service"]["provision"]>(
      (input) =>
        Effect.succeed({
          action: "planned",
          claims: input.definitions.map((d) => d.name),
          removed: [],
          target: "customer-instance",
        })
    );
    await Effect.gen(function* () {
      yield* Command.runWith(
        makeSessionClaimsCommand(
          Layer.succeed(SessionClaimsProvisioner, { provision }),
          definitions
        ),
        { version: "0.0.0" }
      )(["provision", "--dry-run"]);
      expect((yield* TestConsole.logLines).join("\n")).toContain("planned");
    }).pipe(provide, Effect.runPromise);
    expect(provision).toHaveBeenCalledWith({ definitions, dryRun: true });
  });

  it.each([
    ["provision", "--help"],
    ["provision", "--yes"],
  ])(
    "does not resolve credentials for %j without required claims",
    async (...args) => {
      const loaded = vi.fn<() => never>(() => {
        throw new Error("Credentials must not be loaded");
      });
      await Command.runWith(
        makeSessionClaimsCommand(
          Layer.effect(SessionClaimsProvisioner, Effect.sync(loaded)),
          []
        ),
        { version: "0.0.0" }
      )(args).pipe(provide, Effect.runPromise);
      expect(loaded).not.toHaveBeenCalled();
    }
  );
});
