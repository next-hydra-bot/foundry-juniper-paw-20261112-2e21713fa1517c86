import { renderReport } from "@repo/cli-core/command-output";
import { describe, expect, it } from "vitest";

import { clerkOAuthReport } from "./oauth-output";

describe("OAuth setup reports", () => {
  it("shows a read-only plan without claiming an application was provisioned", () => {
    const report = clerkOAuthReport(
      { action: "create", output: "oauth.env", redirectUri: undefined },
      true
    );
    expect(report).toMatchObject({ outcome: "plan", tasks: [] });
  });

  it("reports public connection values and follow-up work without serializing secrets", () => {
    const receipt = {
      action: "created" as const,
      applicationId: "app",
      clientId: "client",
      discoveryUrl: "https://identity.example/.well-known/openid-configuration",
      output: "oauth.env",
      redirectUri: "https://shop.example/callback",
      clientSecret: "private-client-credential",
    };
    const output = renderReport(clerkOAuthReport(receipt, false), {
      color: false,
      width: 88,
    });
    expect(output).toContain(receipt.discoveryUrl);
    expect(output).toContain(receipt.redirectUri);
    expect(output).toContain("Configure and test the relying party");
    expect(output).not.toContain(receipt.clientSecret);
  });
});
