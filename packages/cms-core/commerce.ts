import { Context } from "effect";
import type { ConfigProvider, Effect, FileSystem, Path, Layer } from "effect";
import type {
  AnySelfContainedMigrationDefinition,
  MigrationStore,
  MigrationStoreError,
  DestinationError,
} from "migrate-sdk";

export interface CommerceContentSource {
  readonly categoryKeys: readonly string[];
  readonly categoryMigrationId: string;
}
export interface CommerceContentMigrations {
  readonly target: string;
  readonly store: Layer.Layer<MigrationStore, MigrationStoreError>;
  readonly definitions: readonly AnySelfContainedMigrationDefinition[];
  readonly categories: AnySelfContainedMigrationDefinition;
}
export class CmsCommerceMigrations extends Context.Service<
  CmsCommerceMigrations,
  {
    readonly source: (
      directory: string
    ) => Effect.Effect<
      CommerceContentSource,
      DestinationError,
      FileSystem.FileSystem | Path.Path
    >;
    readonly prepare: (
      config: ConfigProvider.ConfigProvider,
      directory: string,
      stateDirectory: string,
      bindingsFile?: string
    ) => Effect.Effect<
      CommerceContentMigrations,
      DestinationError,
      FileSystem.FileSystem | Path.Path
    >;
  }
>()("@repo/cms-core/CmsCommerceMigrations") {}
