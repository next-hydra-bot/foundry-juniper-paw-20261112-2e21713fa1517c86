import type { AuthRoutes, AuthSession } from "@repo/auth-contract/session";

/** The route supplies the selected authentication provider's readers. */
export interface CustomerAccountAuth {
  readonly readSession: () => Promise<AuthSession>;
  readonly routes: () => Promise<AuthRoutes>;
}
