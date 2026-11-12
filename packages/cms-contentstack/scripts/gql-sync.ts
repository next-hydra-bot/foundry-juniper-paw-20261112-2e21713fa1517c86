import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  generateOutput,
  generateSchema,
  generateTurbo,
} from "@gql.tada/cli-utils";
import { config } from "dotenv";

const tsconfig = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
const schemaUrl = new URL("../gql/schema.graphql", import.meta.url);

function ensureStageSucceeded(stage: string): void {
  if (process.exitCode !== undefined && process.exitCode !== 0) {
    throw new Error(`${stage} failed`);
  }
}

export function deliveryGraphqlUrl(
  host: string,
  apiKey: string,
  environment: string
): URL {
  const url = new URL(
    `/stacks/${encodeURIComponent(apiKey)}`,
    `https://${host}`
  );
  url.searchParams.set("environment", environment);
  return url;
}

export async function generateContentstackGraphql(
  url: URL,
  deliveryToken: string
): Promise<void> {
  await mkdir(new URL("./", schemaUrl), { recursive: true });
  await generateSchema({
    headers: { access_token: deliveryToken },
    input: url.href,
    output: fileURLToPath(schemaUrl),
    tsconfig,
  });
  ensureStageSucceeded("Contentstack schema generation");
  await generateOutput({
    output: fileURLToPath(new URL("./graphql-env.d.ts", schemaUrl)),
    tsconfig,
  });
  ensureStageSucceeded("gql.tada introspection generation");
  const cacheUrl = new URL("./graphql-cache.d.ts", schemaUrl);
  await rm(cacheUrl, { force: true });
  await generateTurbo({
    failOnWarn: true,
    output: fileURLToPath(cacheUrl),
    tsconfig,
  });
  ensureStageSucceeded("gql.tada document cache generation");
}

if (import.meta.main) {
  try {
    config({ quiet: true });
    const {
      CONTENTSTACK_API_KEY: apiKey,
      CONTENTSTACK_DELIVERY_TOKEN: deliveryToken,
      CONTENTSTACK_ENVIRONMENT: environment,
      CONTENTSTACK_GRAPHQL_HOST_NAME: host = "graphql.contentstack.com",
    } = process.env;
    if (!apiKey || !deliveryToken || !environment) {
      throw new Error("The GraphQL delivery configuration is incomplete");
    }
    await generateContentstackGraphql(
      deliveryGraphqlUrl(host, apiKey, environment),
      deliveryToken
    );
  } catch {
    console.error(
      "Contentstack GraphQL generation failed. Check the stack, environment, and composed queries."
    );
    process.exitCode = 1;
  }
}
