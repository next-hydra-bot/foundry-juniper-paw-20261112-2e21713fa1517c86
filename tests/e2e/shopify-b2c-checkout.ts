import { AuthContext } from "@repo/auth-contract/e2e/auth-context";
import { createAuthScenario } from "@repo/auth-contract/e2e/auth-scenario";
import { AuthTestControl } from "@repo/auth-contract/e2e/auth-test-control";
import type { authTestControlLayer as AuthLayer } from "@repo/auth/testing";
import {
  e2eApplicationUrlsFromEnvironment,
  test as base,
} from "@repo/e2e-testing";
import { ManagedRuntime } from "effect";
import { createJiti } from "jiti";

const loader = createJiti(import.meta.url);

export const test = base.extend({
  auth: async ({ page }, provide) => {
    const { authTestControlLayer } = await loader.import<{
      readonly authTestControlLayer: typeof AuthLayer;
    }>("@repo/auth/testing");
    const runtime = ManagedRuntime.make(authTestControlLayer);
    try {
      const auth = new AuthContext({
        applications: {
          web: {
            auth: await runtime.runPromise(AuthTestControl),
            page,
            url: e2eApplicationUrlsFromEnvironment().web,
          },
        },
        scenario: createAuthScenario(),
      });
      try {
        await provide(auth);
      } finally {
        await auth.dispose();
      }
    } finally {
      await runtime.dispose();
    }
  },
});
