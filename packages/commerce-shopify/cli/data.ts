import { authInputModels } from "@repo/auth-contract/provisioning/input-models";
import {
  makeJsonProvisionCommand,
  makeJsonSchemaCommand,
} from "@repo/cli-core/json-migration-command";
import { CustomerInput } from "@repo/commerce-core/domain/customer";
import { commerceInputModels } from "@repo/commerce-core/provisioning/input-models";
import { makeSetupCommand } from "@repo/commerce-core/provisioning/pipeline";
import { Config, ConfigProvider, Effect, Schema } from "effect";
import type { Effect as EffectType } from "effect";
import { Command } from "effect/cli";

import { prepareAdminSettings } from "../admin/provisioning";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- The provider CLI is the migration composition root.
import { makeCustomerDestination } from "../provisioning/customers";
import { prepareB2CProfile } from "../provisioning/profile";

const Domain = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u)
);
export const createDataCommand = <E, R>(
  configProvider: EffectType.Effect<ConfigProvider.ConfigProvider, E, R>
) => {
  const prepare = Effect.gen(function* () {
    const provider = yield* configProvider;
    const domain = yield* Config.String("SHOPIFY_STORE_DOMAIN").pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, provider),
      Effect.flatMap(Schema.decodeUnknownEffect(Domain))
    );
    const settings = yield* prepareAdminSettings(provider);
    return { destination: makeCustomerDestination(settings), target: domain };
  });
  return Command.make("data", {}, () => Effect.void).pipe(
    Command.withSubcommands([
      makeJsonSchemaCommand({ ...commerceInputModels, ...authInputModels }),
      makeSetupCommand(configProvider, prepareB2CProfile),
      makeJsonProvisionCommand({
        id: "customers",
        key: (input: typeof CustomerInput.Type) => input.key,
        prepare,
        revision: "shopify-customers-v1",
        schema: CustomerInput,
      }),
    ])
  );
};
