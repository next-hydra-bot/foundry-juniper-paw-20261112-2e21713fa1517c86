import { runtimeEnvironmentPublisherLayer } from "@repo/cli-core/runtime-environment";
import { ConfigProvider, Layer } from "effect";
import type { Effect } from "effect";

import { contentstackMigrationLedgerLayer } from "./migrations/ledger-live";
import { contentstackCliLayer } from "./provisioning/contentstack-cli-live";
import { contentstackRecipeLayer } from "./provisioning/recipe-live";
import { createContentstackRuntimeCredentialInputLayer } from "./provisioning/runtime-credentials-live";

export const createContentstackProvisioningLayer = <E, R>(
  configProvider: Effect.Effect<ConfigProvider.ConfigProvider, E, R>
) =>
  Layer.mergeAll(
    contentstackCliLayer.pipe(
      Layer.provide(ConfigProvider.layer(configProvider))
    ),
    contentstackMigrationLedgerLayer,
    contentstackRecipeLayer,
    createContentstackRuntimeCredentialInputLayer(configProvider),
    runtimeEnvironmentPublisherLayer
  );
