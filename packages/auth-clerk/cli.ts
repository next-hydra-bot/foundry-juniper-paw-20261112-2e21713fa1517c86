import { makeAuthCommand } from "@repo/auth-contract/cli";
import { makeSessionClaimsCommand } from "@repo/auth-contract/session-claims-cli";
import type { ConfigProvider, Effect } from "effect";

import { createClerkOAuthCommand } from "./oauth-cli";
import { createClerkAuthProvisioningLayer } from "./provisioning";
import { createClerkSessionClaimsLayer } from "./session-claims-provisioning";

export const createAuthCommand = <E, R>(
  configProvider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  makeAuthCommand(
    createClerkAuthProvisioningLayer(configProvider),
    createClerkOAuthCommand(configProvider),
    makeSessionClaimsCommand(createClerkSessionClaimsLayer(configProvider))
  );
