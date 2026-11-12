import { describe, expect, it } from "vitest";

import { migrationPlanReport } from "./provisioning-output";

describe("Migration reports", () => {
  it("preserves migration order and distinguishes a plan from writes", () => {
    expect(
      migrationPlanReport(["customers", "memberships"], "inputs/")
    ).toEqual({
      outcome: "plan",
      summary: "Migration plan prepared. No destination reads or writes.",
      sections: [
        {
          title: "Inputs and migration order",
          facts: [
            { label: "Source", value: "inputs/" },
            { label: "Stage 1", value: "customers" },
            { label: "Stage 2", value: "memberships" },
          ],
        },
      ],
      tasks: [],
    });
  });
});
