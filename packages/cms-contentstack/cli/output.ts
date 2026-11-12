import type { CommandReport, NextTask } from "@repo/cli-core/output-model";
import { runtimeEnvironmentReceiptDescription } from "@repo/cli-core/runtime-environment";
import { runtimeEnvironmentNextTasks } from "@repo/cli-core/runtime-environment-output";

import type { ContentstackProvisioningReceipt } from "./provisioning/model";
import type { ProvisionContentstackOptions } from "./provisioning/provision";
import { contentstackRuntimeEnvironmentManifest } from "./provisioning/runtime-credentials";

export const cmsSteps = {
  destination: {
    group: "CMS",
    title: "Check the credential destination",
    interactive: true,
  },
  access: { group: "CMS", title: "Check Contentstack CLI and stack access" },
  content: {
    group: "CMS",
    title: "Import the composed content model and entries",
    interactive: true,
  },
  migrations: {
    group: "CMS",
    title: "Apply pending content migrations",
    interactive: true,
  },
  previewUrls: { group: "CMS", title: "Configure storefront preview URLs" },
  credentials: {
    group: "CMS",
    title: "Collect runtime credentials",
    interactive: true,
  },
  publication: { group: "CMS", title: "Publish runtime credentials" },
  verify: {
    group: "CMS",
    title:
      "Generate Contentstack GraphQL files and verify the published homepage",
  },
} as const;

export function cmsProvisioningReport(
  receipt: ContentstackProvisioningReceipt,
  options: Pick<
    ProvisionContentstackOptions,
    "localUrl" | "productionUrl" | "managementTokenAlias" | "environment"
  >
): CommandReport {
  const tasks: NextTask[] = [];
  if (receipt.livePreviewConfigurationRequired) {
    tasks.push({
      id: "cms.contentstack.live-preview",
      title: "Configure Live Preview and Visual Editor",
      where: `Contentstack > stack ${receipt.apiKey} > Visual Experience`,
      detail: receipt.previewUrlsConfigured
        ? `The locale base URLs on ${options.environment} point to ${options.productionUrl}. Enable Live Preview and select this environment in Visual Experience.`
        : `Set the locale base URLs on ${options.environment}, the environment used by the app. Use ${options.productionUrl ?? "the hosted storefront origin"} for hosted preview or ${options.localUrl} for local preview. Enable Live Preview and select this environment in Visual Experience.`,
      ...(receipt.previewUrlsConfigured
        ? {}
        : { commands: ["pnpm --filter cli cli cms preview --help"] }),
      verify:
        "Open a page in Live Preview and Visual Editor and verify unpublished changes appear in the intended storefront.",
    });
  }
  tasks.push(
    ...runtimeEnvironmentNextTasks(
      receipt.credentials,
      contentstackRuntimeEnvironmentManifest
    ),
    {
      id: "cms.contentstack.verify",
      title: "Verify CMS delivery",
      where: `Your application > content from ${options.environment}`,
      detail:
        "Publish an entry from the composed content model to the configured environment and open its application URL.",
      verify:
        "Published content loads in the application and draft changes appear through Live Preview when configured.",
    }
  );
  return {
    title: "CMS · Contentstack",
    outcome: "action-required",
    summary: "The stack is provisioned. Complete the application setup below.",
    sections: [
      {
        title: "Provisioned",
        facts: [
          { label: "Stack API Key", value: receipt.apiKey },
          { label: "Environments", value: receipt.environments.join(", ") },
          { label: "Region", value: receipt.region },
          {
            label: "Content import",
            value: receipt.imported ? "completed" : "not applied",
          },
          { label: "Recipe version", value: receipt.recipeVersion },
          {
            label: "Migrations applied",
            value: String(receipt.migrationsApplied),
          },
          {
            label: "Credentials",
            value: runtimeEnvironmentReceiptDescription(receipt.credentials),
          },
          {
            label: "Local Management Token alias",
            value: options.managementTokenAlias,
          },
        ],
      },
    ],
    tasks,
  };
}
