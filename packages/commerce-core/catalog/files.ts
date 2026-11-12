import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { Schema } from "effect";

import { productModelSignature } from "../product/generated/attributes";
import { CompanyCatalogAssignments, companyCatalogPlans } from "./company";
import type { Catalog, CatalogSources } from "./model";
import {
  Catalog as CatalogSchema,
  CatalogName,
  validateCatalog,
} from "./model";
import { productModel } from "./product-model";
import { decodeSellingCatalog } from "./selling";

/** Node-only starter source loader, shared by the selected provider's import CLI. */
export const assertGeneratedModel = () => {
  if (
    createHash("sha256").update(JSON.stringify(productModel)).digest("hex") !==
    productModelSignature
  ) {
    throw new Error(
      "Product model changed; run pnpm --filter @repo/commerce-core catalog generate and rebuild before importing"
    );
  }
};
const readCatalog = (file: string | URL) => {
  assertGeneratedModel();
  return validateCatalog(
    Schema.decodeUnknownSync(Schema.fromJsonString(CatalogSchema))(
      readFileSync(file, "utf-8"),
      { onExcessProperty: "error" }
    ),
    productModel
  );
};

export const loadCatalog = (name: CatalogName) =>
  readCatalog(new URL(`${CatalogName.make(name)}.json`, import.meta.url));

/** Explicit custom input; relative paths resolve from the invoking process. */
export const loadCatalogFile = (file: string | URL) => readCatalog(file);

export type CatalogReaders = Readonly<Record<string, () => Catalog>>;
export type CatalogFiles = Readonly<Record<string, string | URL>>;
export interface CompanyCatalogFiles {
  readonly assignmentsFile: string | URL;
  readonly sellingFile?: string | URL;
}
export interface CatalogMigrationOptions {
  readonly catalogs: CatalogFiles;
  readonly stateDirectory: string | URL;
  readonly company?: CompanyCatalogFiles & {
    readonly bindingsFile: string | URL;
  };
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export const bundledCatalogFiles = {
  b2b: new URL("b2b.json", import.meta.url),
  b2c: new URL("b2c.json", import.meta.url),
};

export type { CatalogSources } from "./model";
export const catalogReaders = (
  files: CatalogFiles = bundledCatalogFiles
): CatalogReaders =>
  Object.fromEntries(
    Object.entries(files).map(([name, file]) => [
      Schema.decodeSync(CatalogName)(name),
      () => loadCatalogFile(file),
    ])
  );

export const loadCatalogSources = (
  files: CatalogFiles = bundledCatalogFiles
): CatalogSources =>
  Object.fromEntries(
    Object.entries(catalogReaders(files)).map(([name, read]) => [name, read()])
  );

export const catalogByName = <A>(
  catalogs: Readonly<Record<string, A>>,
  name: string
): A => {
  const catalog = catalogs[name];
  if (catalog === undefined) {
    throw new Error(`Missing catalog: ${name}`);
  }
  return catalog;
};

export const loadSellingCatalog = (
  catalogs: CatalogSources,
  file?: string | URL
) => {
  const input = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
    readFileSync(file ?? new URL("b2b-selling.json", import.meta.url), "utf-8")
  );
  return decodeSellingCatalog(input, catalogs);
};

export const loadCompanyCatalogSetup = (
  { assignmentsFile, sellingFile }: CompanyCatalogFiles,
  files?: CatalogFiles
) => {
  const catalogs = loadCatalogSources(files);
  const selling = loadSellingCatalog(catalogs, sellingFile);
  const assignments = Schema.decodeUnknownSync(
    Schema.fromJsonString(CompanyCatalogAssignments)
  )(readFileSync(assignmentsFile, "utf-8"), { onExcessProperty: "error" });
  return {
    catalogs,
    plans: companyCatalogPlans(assignments, selling, catalogs),
    selling,
  };
};
