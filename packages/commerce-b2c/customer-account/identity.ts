import { AuthSessionAdapter } from "@repo/auth-contract/session";
import { AuthUserId } from "@repo/commerce-core/domain/commerce-request-context";
import type { CustomerProfileIdentity } from "@repo/commerce-core/services/customer-profiles";
import { Effect, Redacted } from "effect";

import {
  CustomerAccountUnauthenticatedFailure,
  CustomerAccountEmailRequiredFailure,
} from "./action-contract";

export const customerIdentity = Effect.gen(function* () {
  const session = yield* AuthSessionAdapter.read.pipe(Effect.orDie);
  if (session.user === null) {
    return yield* Effect.fail(
      CustomerAccountUnauthenticatedFailure.make({
        message: "Sign in to manage a Customer account.",
      })
    );
  }
  const email = session.user.email?.trim();
  if (!email) {
    return yield* Effect.fail(
      CustomerAccountEmailRequiredFailure.make({
        message:
          "Add an email address to the sign-in account before continuing.",
      })
    );
  }
  return {
    authUserId: AuthUserId.make(session.user.id),
    email: Redacted.make(email, { label: "email" }),
  } satisfies CustomerProfileIdentity;
});
