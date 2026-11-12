import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { renderReport } from "@repo/cli-core/command-output";
import { Schema } from "effect";

import { generateProductModel } from "./generate";
import { catalogJsonSchema, decodeCatalog } from "./model";
import {
  decodeProductModel,
  productModel,
  productModelJsonSchema,
} from "./product-model";
import { decodeSellingCatalog, sellingCatalogJsonSchema } from "./selling";

const readJson = async (file: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
    await readFile(path.resolve(file), "utf-8")
  );

const printCatalogResult = (summary: string) =>
  process.stdout.write(
    `${renderReport(
      {
        outcome: "ready",
        summary,
        sections: [],
        tasks: [],
      },
      {
        color: process.stdout.isTTY ?? false,
        width: process.stdout.columns ?? 80,
      }
    )}\n`
  );

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    catalog: { type: "string" },
    help: { type: "boolean" },
    model: { type: "string" },
    output: { type: "string" },
    selling: { type: "string" },
  },
});
const command = positionals[0] ?? "validate";
if (values.help) {
  process.stdout.write(
    "catalog generate|validate|validate-selling|schema|model-schema|selling-schema [--model model.json] [--catalog catalog.json] [--selling selling.json] [--output schema.json]\nGenerate installs the model and regenerates Core types. Validation and schema output do not write application files.\n"
  );
} else {
  if (
    ![
      "generate",
      "validate",
      "validate-selling",
      "schema",
      "model-schema",
      "selling-schema",
    ].includes(command) ||
    positionals.length > 1
  ) {
    throw new Error("Unknown catalog command; use --help");
  }
  const model =
    values.model === undefined
      ? productModel
      : decodeProductModel(await readJson(values.model));
  if (values.catalog !== undefined) {
    decodeCatalog(await readJson(values.catalog), model);
  }
  if (command === "validate-selling") {
    if (!values.selling || !values.catalog) {
      throw new Error(
        "validate-selling requires --selling and --catalog JSON files"
      );
    }
    const catalog = decodeCatalog(await readJson(values.catalog), model);
    const input = await readJson(values.selling);
    const { sourceCatalog } = Schema.decodeUnknownSync(
      Schema.Struct({ sourceCatalog: Schema.String })
    )(input);
    decodeSellingCatalog(input, { [sourceCatalog]: catalog });
    printCatalogResult(
      "Selling catalog, Store mappings, assortments and prices are valid."
    );
  } else if (command === "generate") {
    await generateProductModel(
      model,
      fileURLToPath(new URL("../", import.meta.url))
    );
    printCatalogResult(
      "Product model and Core types generated. Rebuild the storefront before using new types."
    );
  } else if (
    command === "schema" ||
    command === "model-schema" ||
    command === "selling-schema"
  ) {
    let schema = catalogJsonSchema(model);
    if (command === "model-schema") {
      schema = productModelJsonSchema();
    }
    if (command === "selling-schema") {
      schema = sellingCatalogJsonSchema();
    }
    const output = `${JSON.stringify(schema, null, 2)}\n`;
    if (values.output === undefined) {
      process.stdout.write(output);
    } else {
      await writeFile(path.resolve(values.output), output);
    }
  } else {
    printCatalogResult("Product model and supplied catalog are valid.");
  }
}
