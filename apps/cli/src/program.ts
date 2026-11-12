import { createAuthCommand } from "@repo/auth/cli";
import { authDataProvisionerLayer } from "@repo/auth/data-provisioning";
import {
  composeProvisioningInputModels,
  ProvisioningInputModels,
} from "@repo/cli-core/provisioning-input-models";
import { createCmsCommand } from "@repo/cms/cli";
import { createCommerceCommand } from "@repo/commerce-provider/cli";
import { cmsCommerceMigrationsLayer } from "@repo/commerce-provider/provisioning/cms-data";
import { Effect, Layer, Option } from "effect";
import { CliConfig, Command, Flag, GlobalFlag } from "effect/cli";

import { loadCliConfigProvider } from "./config-provider";

export const workspaceCliConfig = CliConfig.make({
  builtIns: [GlobalFlag.Help, GlobalFlag.Version],
});

export const createProgram = (
  loadConfigProvider: typeof loadCliConfigProvider = loadCliConfigProvider
) => {
  const root = Command.make("cli", {}, () => Effect.void).pipe(
    Command.withDescription("Workspace administration CLI"),
    Command.withSharedFlags({
      envFile: Flag.String("env-file").pipe(
        Flag.withDescription(
          "Load environment variables from a file before validating package keys"
        ),
        Flag.optional
      ),
    })
  );

  const configProvider = Effect.gen(function* () {
    const { envFile } = yield* root;
    return yield* loadConfigProvider(Option.getOrUndefined(envFile));
  });

  return root.pipe(
    Command.withSubcommands([
      createCmsCommand(configProvider),

      ...[createAuthCommand, createCommerceCommand].map((createCommand) =>
        createCommand(configProvider)
      ),
    ]),
    Command.provide(
      Layer.mergeAll(
        Layer.effect(
          ProvisioningInputModels,
          composeProvisioningInputModels([])
        ),
        ...[authDataProvisionerLayer, cmsCommerceMigrationsLayer]
      )
    )
  );
};
