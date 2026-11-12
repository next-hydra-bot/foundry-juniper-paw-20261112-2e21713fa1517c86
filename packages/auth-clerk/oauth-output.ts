import type { CommandReport } from "@repo/cli-core/output-model";
import type { Effect } from "effect";

import type { provisionClerkOAuth } from "./oauth-provisioning";

export const clerkOAuthReport = (
  receipt: Effect.Success<ReturnType<typeof provisionClerkOAuth>>,
  dryRun: boolean
): CommandReport => ({
  outcome: dryRun ? "plan" : "action-required",
  summary: `Clerk OAuth ${dryRun ? "plan" : "configuration"}: ${receipt.action}.`,
  sections: [
    {
      title: "OAuth application",
      facts: [
        { label: "Private credential file", value: receipt.output },
        ...("clientId" in receipt &&
        receipt.clientId !== undefined &&
        receipt.discoveryUrl !== undefined
          ? [
              { label: "Client ID", value: receipt.clientId },
              { label: "Discovery URL", value: receipt.discoveryUrl },
            ]
          : []),
        ...(receipt.redirectUri === undefined
          ? []
          : [{ label: "Registered callback", value: receipt.redirectUri }]),
      ],
    },
  ],
  tasks: dryRun
    ? []
    : [
        {
          id: "clerk.oauth.connect",
          title: "Configure and test the relying party",
          where:
            "Shopify Admin > Customer accounts > Identity provider, or your selected relying party",
          detail:
            "Use the client ID, discovery URL and secret from the private credential file. Register the exact callback returned by the relying party; activation is not performed by this command.",
          verify:
            "The identity-provider connection test completes successfully.",
        },
      ],
  notes: [
    "The client secret stays in the private credential file and is never printed.",
  ],
});
