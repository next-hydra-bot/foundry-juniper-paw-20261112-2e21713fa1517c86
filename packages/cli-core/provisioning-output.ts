import type { MigrationRunSummary } from "migrate-sdk";

import type { CommandReport } from "./output-model";

export const migrationPlanReport = (
  definitions: readonly string[],
  source: string
): CommandReport => ({
  outcome: "plan",
  summary: "Migration plan prepared. No destination reads or writes.",
  sections: [
    {
      title: "Inputs and migration order",
      facts: [
        { label: "Source", value: source },
        ...definitions.map((value, index) => ({
          label: `Stage ${index + 1}`,
          value,
        })),
      ],
    },
  ],
  tasks: [],
});

export const migrationRunReport = (
  summary: MigrationRunSummary,
  stateDirectory: string
): CommandReport => ({
  outcome: "ready",
  summary: "Provisioning completed successfully.",
  sections: [
    {
      title: "Migration run",
      facts: [
        { label: "Run", value: summary.runId },
        { label: "State directory", value: stateDirectory },
      ],
    },
    {
      title: "Stages",
      facts: summary.definitions.map((definition) => ({
        label: definition.definitionId,
        value: definition.status,
      })),
    },
  ],
  tasks: [],
});
