import type { CommandReport } from "@repo/cli-core/output-model";
import { runtimeEnvironmentReceiptDescription } from "@repo/cli-core/runtime-environment";
import { runtimeEnvironmentNextTasks } from "@repo/cli-core/runtime-environment-output";
import type { Effect } from "effect";

import type { configureCustomerAccounts } from "./customer-accounts";
import type { MarketProvisioningChange } from "./markets";

export const shopifyMarketsReport = (
  changes: readonly MarketProvisioningChange[],
  dryRun: boolean
): CommandReport => ({
  outcome: dryRun ? "plan" : "action-required",
  sections: [
    {
      facts: changes.map((change) => ({
        label: `${change.key} · ${change.action}`,
        value: `${change.handle} · ${change.countries.join(", ")} · ${change.currency}`,
      })),
      title: "Markets",
    },
  ],
  summary: dryRun
    ? "Shopify project plan prepared. No changes applied."
    : "Shopify Markets configured.",
  tasks: dryRun
    ? []
    : [
        {
          commands: [
            "pnpm --filter cli cli commerce data setup --directory <directory> --state-directory .migrate",
          ],
          detail:
            "Use the B2C or B2B provisioning directory for this storefront.",
          id: "shopify.catalog",
          title: "Import the selected catalog and customer data",
          where: "Workspace CLI",
        },
        {
          detail:
            "Configure shipping rates covering your test address and a test payment gateway. Market provisioning does not activate payment providers or shipping services.",
          id: "shopify.selling",
          title: "Configure shipping and test payments",
          verify:
            "The selected Market accepts the test address and currency at checkout.",
          where: "Shopify Admin > Settings",
        },
      ],
});

export const shopifyCustomerAccountsReport = (
  result: Effect.Success<ReturnType<typeof configureCustomerAccounts>>
): CommandReport => ({
  outcome: "action-required",
  sections: [
    {
      facts: [
        { label: "Storefront", value: result.origin },
        {
          label: "Configuration",
          value: runtimeEnvironmentReceiptDescription(result.receipt),
        },
        { label: "Callback URL", value: result.callback },
        { label: "Logout URL", value: result.logoutCallback },
      ],
      title: "Customer session",
    },
  ],
  summary: "Customer Account runtime configuration published.",
  tasks: [
    ...runtimeEnvironmentNextTasks(result.receipt, [
      {
        applications: ["web"],
        key: "SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID",
        sensitive: false,
      },
    ]),
    {
      detail: `Register ${result.callback} as a callback URL and ${result.logoutCallback} as a Logout URI. When using WorkOS, register ${result.signOutContinuation} as its Sign-out URI.`,
      id: "shopify.account-urls",
      title: "Register the storefront URLs",
      verify: "Shopify returns to the storefront after sign-in and sign-out.",
      where: "Shopify Admin > Headless > Customer Account client",
    },
    {
      detail:
        "Complete the Clerk or WorkOS connection using that provider's setup guide. Its Shopify callback is separate from the storefront callback above.",
      id: "shopify.identity",
      title: "Connect the selected identity provider",
      verify:
        "The connection test succeeds and checkout uses the signed-in storefront customer.",
      where: "Shopify Admin > Customer accounts > Identity provider",
    },
  ],
});
