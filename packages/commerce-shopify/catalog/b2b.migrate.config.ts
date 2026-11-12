import { bundledCatalogFiles } from "@repo/commerce-core/catalog/files";

import { defineCatalogMigrationConfig } from "./migration-config";

export default await defineCatalogMigrationConfig({
  catalogs: { b2b: bundledCatalogFiles.b2b },
  stateDirectory: new URL(".migrate/", import.meta.url),
  company: {
    assignmentsFile: new URL(
      "../../commerce-b2b/catalog/assignments.json",
      import.meta.url
    ),
    sellingFile: new URL(
      "../../commerce-core/catalog/b2b-selling.json",
      import.meta.url
    ),
    bindingsFile: new URL("b2b-bindings.json", import.meta.url),
  },
});
