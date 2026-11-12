import type { setupAuthTesting as SetupAuthTesting } from "@repo/auth/testing";
import { createJiti } from "jiti";

const loader = createJiti(import.meta.url);

export async function setupAuthentication(): Promise<void> {
  const { setupAuthTesting } = await loader.import<{
    readonly setupAuthTesting: typeof SetupAuthTesting;
  }>("@repo/auth/testing");
  await setupAuthTesting();
}
