import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { Console, Effect, Schema } from "effect";
import { CliError, Command, Flag } from "effect/cli";

export class RedirectThemeError extends Schema.TaggedError<RedirectThemeError>()(
  "RedirectThemeError",
  { message: Schema.String }
) {}

const directories = [
  "assets",
  "config",
  "layout",
  "locales",
  "sections",
  "snippets",
  "templates",
];
const receiptName = ".redirect-theme-receipt.json";
const exists = async (file: string) =>
  lstat(file).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  );
const inside = (parent: string, child: string) =>
  child === parent || child.startsWith(parent + path.sep);

async function digest(directory: string): Promise<string> {
  const entries: string[] = [];
  const visit = async (relative: string) => {
    for (const entry of await readdir(path.join(directory, relative), {
      withFileTypes: true,
    })) {
      const file = path.join(relative, entry.name);
      if (entry.isSymbolicLink())
        throw new Error("Theme sources must not contain symbolic links.");
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) entries.push(file);
    }
  };
  for (const name of directories)
    if (await exists(path.join(directory, name))) await visit(name);
  const hash = createHash("sha256");
  // Sort the freshly built file list; the workspace targets ES2022.
  // eslint-disable-next-line unicorn/no-array-sort -- deterministic manifest over a local list.
  for (const file of entries.sort()) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(path.join(directory, file)))
      .update("\0");
  }
  return hash.digest("hex");
}

/** Prepare a separate theme copy. Publishing remains Shopify CLI's operation. */
export const prepareRedirectTheme = (options: {
  readonly source: string;
  readonly output: string;
  readonly origin: string;
  readonly dryRun: boolean;
}) =>
  Effect.tryPromise({
    try: async () => {
      const origin = new URL(options.origin);
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        origin.port ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      ) {
        throw new Error(
          "Use the storefront HTTPS origin without a path, credentials or non-default port."
        );
      }
      const source = path.resolve(options.source);
      const output = path.resolve(options.output);
      if (inside(source, output) || inside(output, source))
        throw new Error("Use separate source and output theme directories.");
      const schema: unknown = JSON.parse(
        await readFile(path.join(source, "config/settings_schema.json"), "utf8")
      );
      if (
        !Array.isArray(schema) ||
        !schema.some(
          (group) =>
            Array.isArray(group.settings) &&
            group.settings.some(
              (setting: { id?: string }) => setting.id === "storefront_hostname"
            )
        )
      ) {
        throw new Error(
          "The redirect theme must expose the storefront_hostname setting."
        );
      }
      await readFile(path.join(source, "layout/theme.liquid"));
      const sourceDigest = await digest(source);
      const identity = { source, sourceDigest, origin: origin.origin, output };
      if (await exists(output)) {
        const saved = JSON.parse(
          await readFile(path.join(output, receiptName), "utf8")
        );
        if (
          saved.source !== source ||
          saved.sourceDigest !== sourceDigest ||
          saved.origin !== origin.origin ||
          saved.output !== output ||
          saved.outputDigest !== (await digest(output))
        ) {
          throw new Error(
            "The output belongs to another theme revision or was changed. Reconcile it or choose a new output directory."
          );
        }
        return { ...saved, idempotent: true, dryRun: options.dryRun };
      }
      if (options.dryRun) return { ...identity, dryRun: true };
      await mkdir(path.dirname(output), { recursive: true });
      const staging = await mkdtemp(
        path.join(path.dirname(output), ".redirect-theme-")
      );
      try {
        for (const name of directories) {
          const entry = path.join(source, name);
          if (await exists(entry))
            await cp(entry, path.join(staging, name), {
              recursive: true,
              errorOnExist: true,
              force: false,
            });
        }
        const settingsFile = path.join(staging, "config/settings_data.json");
        const settings = (await exists(settingsFile))
          ? JSON.parse(await readFile(settingsFile, "utf8"))
          : { current: {} };
        if (
          typeof settings.current !== "object" ||
          settings.current === null ||
          Array.isArray(settings.current)
        )
          throw new Error("Theme current settings must be an object.");
        settings.current.storefront_hostname = origin.hostname;
        await writeFile(settingsFile, JSON.stringify(settings, null, 2) + "\n");
        const receipt = { ...identity, outputDigest: await digest(staging) };
        await writeFile(
          path.join(staging, receiptName),
          JSON.stringify(receipt, null, 2) + "\n"
        );
        await rename(staging, output);
        return { ...receipt, dryRun: false };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    },
    catch: (error) =>
      new RedirectThemeError({
        message:
          error instanceof Error && !("code" in error)
            ? error.message
            : "Could not prepare the redirect theme. Check source files and output permissions.",
      }),
  });

export const createRedirectThemeCommand = () =>
  Command.make("redirect-theme").pipe(
    Command.withDescription(
      "Prepare a redirect theme for publishing with Shopify CLI"
    ),
    Command.withSubcommands([
      Command.make(
        "prepare",
        {
          source: Flag.String("source").pipe(
            Flag.withDescription(
              "Local checkout of the redirect theme; pin its Git revision before use"
            )
          ),
          output: Flag.String("output").pipe(
            Flag.withDescription("New directory for the configured theme copy")
          ),
          origin: Flag.String("origin").pipe(
            Flag.withDescription("Public HTTPS frontend origin")
          ),
          dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
        },
        (options) =>
          prepareRedirectTheme(options).pipe(
            Effect.flatMap((receipt) => Console.log(JSON.stringify(receipt))),
            Effect.mapError(
              (error) =>
                new CliError.UserError({
                  cause: undefined,
                  userMessage: error.message,
                })
            )
          )
      ),
    ])
  );
