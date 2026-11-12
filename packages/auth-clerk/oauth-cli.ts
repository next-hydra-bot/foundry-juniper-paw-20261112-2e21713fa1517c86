import {
  phase,
  renderReport,
  withCommandOutput,
} from "@repo/cli-core/command-output";
import {
  Config,
  ConfigProvider,
  Console,
  Effect,
  Option,
  PlatformError,
  Schema,
} from "effect";
import type { Effect as EffectType } from "effect";
import { CliError, Command, Flag, Prompt } from "effect/cli";

import { clerkOAuthReport } from "./oauth-output";
import {
  clerkOAuthFileLayer,
  ClerkOAuthProvisioningError,
  // oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This CLI composition root supplies the provider-owned API and private file capability.
  makeClerkOAuthApi,
  provisionClerkOAuth,
} from "./oauth-provisioning";

export const createClerkOAuthCommand = <E, R>(
  provider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const provision = Command.make(
    "provision",
    {
      dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
      name: Flag.String("name").pipe(
        Flag.withDefault("Storefront customer sign-in")
      ),
      output: Flag.String("output").pipe(
        Flag.withDefault(".env.oauth.local"),
        Flag.withDescription(
          "Private OAuth credential file; an existing file selects the same application on rerun"
        )
      ),
      redirectUri: Flag.String("redirect-uri").pipe(
        Flag.optional,
        Flag.withDescription(
          "Exact callback supplied by the relying party, for example Shopify's identity-provider callback"
        )
      ),
      yes: Flag.Boolean("yes").pipe(Flag.withDefault(false)),
    },
    (flags) =>
      withCommandOutput(
        {
          title: "Configure customer OAuth",
          context: "Clerk",
          failureNote:
            "The OAuth application or private credential file may already exist. Reuse the credential file before retrying.",
        },
        (style) =>
          Effect.gen(function* () {
            const config = yield* provider.pipe(
              Effect.mapError((error) => {
                const file =
                  PlatformError.isPlatformError(error) &&
                  error.reason.module === "FileSystem" &&
                  "pathOrDescriptor" in error.reason
                    ? error.reason.pathOrDescriptor
                    : undefined;
                return new ClerkOAuthProvisioningError({
                  message: `Could not load the CLI environment file${file === undefined ? "." : `: ${file}.`} Pass --env-file with an absolute path to your bootstrap file. Relative paths resolve inside apps/cli.`,
                });
              })
            );
            const secret = yield* Config.schema(
              Schema.RedactedFromValue(Schema.NonEmptyString),
              "CLERK_SECRET_KEY"
            ).pipe(
              Effect.provideService(ConfigProvider.ConfigProvider, config),
              Effect.mapError(
                () =>
                  new ClerkOAuthProvisioningError({
                    message:
                      "CLERK_SECRET_KEY is missing or empty. Load the customer Clerk application's key with --env-file /absolute/path/to/.env.bootstrap.local, or set it in the shell. ADMIN_CLERK_SECRET_KEY does not configure customer OAuth. Without --env-file, the CLI reads apps/cli/.env; it does not load the workspace-root bootstrap file automatically. No Clerk API request was sent.",
                  })
              )
            );
            if (!flags.dryRun && !flags.yes) {
              const confirmed = yield* Prompt.run(
                Prompt.Confirm({
                  initial: false,
                  message:
                    "Provision the customer Clerk OAuth application and save or reuse its private credential file?",
                })
              );
              if (!confirmed) {
                return;
              }
            }
            const receipt = yield* phase(
              {
                group: "OAuth",
                title: flags.dryRun
                  ? "Read the OAuth plan"
                  : "Configure the OAuth application",
              },
              provisionClerkOAuth({
                api: makeClerkOAuthApi(secret),
                dryRun: flags.dryRun,
                name: flags.name,
                output: flags.output,
                redirectUri: Option.getOrUndefined(flags.redirectUri),
              })
            );
            yield* Console.log(
              renderReport(clerkOAuthReport(receipt, flags.dryRun), style)
            );
          }).pipe(
            Effect.mapError(
              (error) =>
                new CliError.UserError({
                  cause: undefined,
                  userMessage: Schema.is(ClerkOAuthProvisioningError)(error)
                    ? error.message
                    : "Clerk OAuth provisioning failed. Check credentials, output-file permissions and configuration.",
                })
            )
          )
      )
  ).pipe(Command.provide(clerkOAuthFileLayer));
  return Command.make("oauth", {}, () => Effect.void).pipe(
    Command.withDescription(
      "Provision confidential customer OAuth applications"
    ),
    Command.withSubcommands([provision])
  );
};
