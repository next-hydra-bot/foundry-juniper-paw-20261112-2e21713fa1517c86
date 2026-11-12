/* oxlint-disable no-await-in-loop -- Setup hooks run in composition order after application health checks. */
import type { FullConfig } from "@playwright/test";

import { checkApplicationHealth } from "./application-health";
import { setupAuthentication } from "./authentication";

export default async function setup(config: FullConfig) {
  await checkApplicationHealth(config);
  const initializers: (() => Promise<void>)[] = [setupAuthentication];
  for (const initialize of initializers) {
    await initialize();
  }
}
