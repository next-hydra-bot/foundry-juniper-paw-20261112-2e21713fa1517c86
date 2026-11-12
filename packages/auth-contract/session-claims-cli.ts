import { renderReport, withCommandOutput } from "@repo/cli-core/command-output";
import { Console, Effect, Schema } from "effect";
import type { Layer } from "effect";
import { CliError, Command, Flag, Prompt } from "effect/cli";

import { storefrontSessionClaims } from "./session-claims";
import {
  SessionClaimsProvisioner,
  SessionClaimsProvisioningError,
} from "./session-claims-provisioning";
import type { SessionClaimDefinition } from "./session-claims-provisioning";

export const makeSessionClaimsCommand = <E, R>(
  providerLayer: Layer.Layer<SessionClaimsProvisioner, E, R>,
  definitions: readonly SessionClaimDefinition[] = storefrontSessionClaims
) => {
  const provision = Command.make(
    "provision",
    {
      dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
      yes: Flag.Boolean("yes").pipe(Flag.withDefault(false)),
    },
    ({ dryRun, yes }) =>
      withCommandOutput(
        {
          context: "Customer authentication",
          failureNote:
            "Read the current customer session template before retrying an interrupted update.",
          title: "Configure storefront session claims",
        },
        (style) =>
          Effect.gen(function* () {
            if (definitions.length === 0) {
              yield* Console.log(
                "No storefront session claims are required by the installed recipes."
              );
              return;
            }
            if (!dryRun && !yes) {
              const confirmed = yield* Prompt.run(
                Prompt.Confirm({
                  initial: false,
                  message:
                    "Configure the customer authentication application's session claims?",
                })
              );
              if (!confirmed) {
                return;
              }
            }
            const receipt = yield* SessionClaimsProvisioner.pipe(
              Effect.flatMap((provisioner) =>
                provisioner.provision({ definitions, dryRun })
              ),
              Effect.provide(providerLayer)
            );
            yield* Console.log(
              renderReport(
                {
                  notes: [
                    "Existing sessions receive current metadata after their tokens refresh.",
                  ],
                  outcome: dryRun ? "plan" : "ready",
                  sections: [
                    {
                      facts: [
                        { label: "Target", value: receipt.target },
                        { label: "Claims", value: receipt.claims.join(", ") },
                        ...(receipt.removed.length
                          ? [
                              {
                                label: "Replaced claims",
                                value: receipt.removed.join(", "),
                              },
                            ]
                          : []),
                      ],
                      title: "Customer session template",
                    },
                  ],
                  summary: `Storefront session claims: ${receipt.action}.`,
                  tasks: [],
                },
                style
              )
            );
          }).pipe(
            Effect.mapError(
              (error) =>
                new CliError.UserError({
                  cause: undefined,
                  userMessage: Schema.is(SessionClaimsProvisioningError)(error)
                    ? error.message
                    : "Could not configure storefront claims. Check the input env file and customer provisioning credentials.",
                })
            )
          )
      )
  );
  return Command.make("claims", {}, () => Effect.void).pipe(
    Command.withDescription(
      "Configure session claims required by installed storefront features"
    ),
    Command.withSubcommands([provision])
  );
};
