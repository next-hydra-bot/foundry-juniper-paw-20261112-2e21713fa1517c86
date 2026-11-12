import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Console, Effect, Exit } from "effect";
import { CliConfig, Command, GlobalFlag } from "effect/cli";

import { createCommerceCommand } from "./index";

describe("Shopify provisioning command", () => {
  it.effect(
    "documents customer-session configuration without loading credentials",
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
          createCommerceCommand(Effect.die("Help must not load credentials")),
          { version: "0.0.0" }
        )(["customer-accounts", "--help"]).pipe(
          Effect.provideService(
            CliConfig.CliConfig,
            CliConfig.make({ builtIns: [GlobalFlag.Help] })
          ),
          Effect.provideService(Console.Console, logger),
          Effect.provide(NodeServices.layer),
          Effect.exit
        );
        expect(Exit.isSuccess(result)).toBeTruthy();
        expect(output.join("\n")).toContain("--client-id");
        expect(output.join("\n")).toContain("--origin");
      })
  );
  it.effect("documents Market provisioning without resolving credentials", () =>
    Effect.gen(function* () {
      const output: string[] = [];
      const testConsole: Console.Console = {
        ...console,
        log: (...values: readonly unknown[]) => {
          output.push(values.join(" "));
        },
      };
      const exit = yield* Command.runWith(
        createCommerceCommand(Effect.die("Help must not load credentials")),
        { version: "0.0.0" }
      )(["project", "provision", "--help"]).pipe(
        Effect.provideService(
          CliConfig.CliConfig,
          CliConfig.make({ builtIns: [GlobalFlag.Help] })
        ),
        Effect.provideService(Console.Console, testConsole),
        Effect.provide(NodeServices.layer),
        Effect.exit
      );
      expect(Exit.isSuccess(exit)).toBeTruthy();
      expect(output.join("\n")).toContain("--dry-run");
      expect(output.join("\n")).toContain("--stores");
    })
  );
});
