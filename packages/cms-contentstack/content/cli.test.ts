import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit } from "effect";
import { Command } from "effect/cli";
import { describe, expect, it } from "vitest";

import { createCmsCommand } from "../cli/index";

describe("Contentstack content CLI", () => {
  it("initializes, validates, plans offline and rejects broken sources", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cms-contentstack-cli-"));
    const run = async (args: string[]) =>
      await Command.runWith(
        createCmsCommand(Effect.die("No credentials needed")),
        {
          version: "test",
        }
      )(["data", ...args]).pipe(
        Effect.provide(NodeServices.layer),
        Effect.exit,
        Effect.runPromise
      );
    try {
      expect(
        Exit.isSuccess(await run(["init", "--directory", directory]))
      ).toBeTruthy();
      expect(
        Exit.isSuccess(await run(["validate", "--directory", directory]))
      ).toBeTruthy();
      expect(
        Exit.isSuccess(await run(["setup", "--directory", directory, "--plan"]))
      ).toBeTruthy();
      const unaddressed = await run(["setup", "--directory", directory]);
      const failure = Exit.isFailure(unaddressed)
        ? Cause.squash(unaddressed.cause)
        : undefined;
      expect(failure instanceof Error ? failure.message : "").toContain(
        "--management-token-alias"
      );
      const navigation = JSON.parse(
        readFileSync(join(directory, "navigation.json"), "utf-8")
      );
      navigation[0].items[0].link.entryKey = "absent";
      writeFileSync(
        join(directory, "navigation.json"),
        JSON.stringify(navigation)
      );
      expect(
        Exit.isFailure(await run(["setup", "--directory", directory, "--plan"]))
      ).toBeTruthy();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
