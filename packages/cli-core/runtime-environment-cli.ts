import { Option } from "effect";
import { Flag } from "effect/cli";

import type {
  RuntimeEnvironmentDestination,
  VercelEnvironmentSelector,
} from "./runtime-environment";

const DESTINATIONS = ["local", "vercel"] as const;

export const runtimeEnvironmentDestinationFlags = () => ({
  environment: Flag.String("environment").pipe(
    Flag.withDescription(
      "Vercel production, preview, preview:<branch>, or custom environment; repeat as needed"
    ),
    Flag.atLeast(0)
  ),
  output: Flag.String("output").pipe(
    Flag.withDescription("New local dotenv file for runtime configuration"),
    Flag.withDefault(".env.local")
  ),
  overwrite: Flag.Boolean("overwrite").pipe(
    Flag.withDescription(
      "Replace exact provider-owned variables in selected Vercel environments"
    ),
    Flag.withDefault(false)
  ),
  store: Flag.Literals("store", DESTINATIONS).pipe(
    Flag.withDescription("Runtime configuration store"),
    Flag.withDefault("local")
  ),
  vercelProject: Flag.String("vercel-project").pipe(
    Flag.withDescription(
      "Explicit app=prj_... destination; repeat for each app"
    ),
    Flag.atLeast(0)
  ),
  vercelTeam: Flag.String("vercel-team").pipe(
    Flag.withDescription("Team ID for explicit Vercel project destinations"),
    Flag.optional
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Skip the provisioning confirmation")
  ),
});

export interface RuntimeEnvironmentDestinationFlagValues {
  readonly environment: readonly VercelEnvironmentSelector[];
  readonly output: string;
  readonly overwrite: boolean;
  readonly store: "local" | "vercel";
  readonly yes: boolean;
  readonly vercelProject?: readonly string[];
  readonly vercelTeam?: Option.Option<string>;
}

export const runtimeEnvironmentDestinationFromFlags = (
  flags: RuntimeEnvironmentDestinationFlagValues
): RuntimeEnvironmentDestination =>
  flags.store === "local"
    ? {
        destination: "local",
        output: flags.output,
        publicationMode: flags.overwrite ? "overwrite" : "create",
        yes: flags.yes,
      }
    : {
        destination: "vercel",
        environments: flags.environment,
        ...(flags.vercelProject?.length
          ? { projectAssignments: flags.vercelProject }
          : {}),
        ...(flags.vercelTeam === undefined
          ? {}
          : { teamId: Option.getOrUndefined(flags.vercelTeam) }),
        publicationMode: flags.overwrite ? "overwrite" : "create",
        yes: flags.yes,
      };
