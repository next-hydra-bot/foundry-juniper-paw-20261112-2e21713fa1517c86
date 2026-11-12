import { Context, Effect, Schema } from "effect";

export type ProvisioningInputModelMap = Readonly<
  Record<string, Schema.Codec<unknown, unknown>>
>;

/** Recipes contribute schema vocabulary; this contains no customer data or authority. */
export class ProvisioningInputModels extends Context.Service<
  ProvisioningInputModels,
  ProvisioningInputModelMap
>()("@repo/cli-core/ProvisioningInputModels") {}

export class ProvisioningInputModelConflict extends Schema.TaggedError<ProvisioningInputModelConflict>()(
  "ProvisioningInputModelConflict",
  {
    model: Schema.String,
  }
) {}

export const composeProvisioningInputModels = (
  models: readonly ProvisioningInputModelMap[]
) =>
  Effect.gen(function* () {
    const entries = new Map<string, Schema.Codec<unknown, unknown>>();
    for (const contribution of models) {
      for (const [name, schema] of Object.entries(contribution)) {
        const previous = entries.get(name);
        if (previous && previous !== schema) {
          return yield* new ProvisioningInputModelConflict({ model: name });
        }
        entries.set(name, schema);
      }
    }
    return Object.fromEntries(entries);
  });
