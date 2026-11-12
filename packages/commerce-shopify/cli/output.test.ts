import { renderReport } from "@repo/cli-core/command-output";
import { LocalRuntimeEnvironmentPublicationReceipt } from "@repo/cli-core/runtime-environment";
import { describe, expect, it } from "vitest";

import { shopifyCustomerAccountsReport, shopifyMarketsReport } from "./output";

describe("Shopify setup reports", () => {
  it("keeps the Market plan separate from follow-up actions", () => {
    expect(shopifyMarketsReport([], true)).toMatchObject({
      outcome: "plan",
      tasks: [],
    });
  });

  it("shows explicit Market countries and currency and the remaining checkout configuration", () => {
    const report = shopifyMarketsReport(
      [
        {
          action: "create",
          countries: ["GB"],
          currency: "GBP",
          handle: "region",
          key: "region",
          name: "Region",
        },
      ],
      false
    );
    expect(report).toMatchObject({
      outcome: "action-required",
      sections: [{ facts: [{ value: "region · GB · GBP" }] }],
    });
    expect(report.tasks.map((task) => task.id)).toEqual([
      "shopify.catalog",
      "shopify.selling",
    ]);
  });

  it("provides exact callbacks and publication guidance without printing private values", () => {
    const origin = "https://store.example";
    const result = {
      callback: `${origin}/account/authorize`,
      logoutCallback: `${origin}/account/logout/complete`,
      origin,
      receipt: new LocalRuntimeEnvironmentPublicationReceipt({
        destination: "local",
        mode: 0o600,
        path: "customer-accounts.env",
      }),
      sessionSecret: "private-session-credential",
      shopId: "123",
      signOutContinuation: `${origin}/account/logout/continue`,
    };
    const output = renderReport(shopifyCustomerAccountsReport(result), {
      color: false,
      width: 88,
    });
    expect(output).toContain(result.callback);
    expect(output).toContain(result.logoutCallback);
    expect(output).toContain("Apply the runtime configuration");
    expect(output).not.toContain(result.sessionSecret);
  });
});
