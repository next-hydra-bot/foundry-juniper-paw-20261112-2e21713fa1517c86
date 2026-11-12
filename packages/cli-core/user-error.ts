import { CliError } from "effect/cli";

const MAX_CAUSE_DEPTH = 4;

/**
 * Provider errors keep the actionable reason in `cause`, which the CLI
 * formatter does not render. Causes must already be safe to print.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Effect error channels and cause chains are untyped at the CLI boundary.
export const failureMessage = (failure: unknown): string | undefined => {
  const lines: string[] = [];
  let current = failure;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current instanceof Error;
    depth += 1
  ) {
    const message = current.message.trim();
    if (message && !lines.includes(message)) {
      lines.push(message);
    }
    current = current.cause;
  }
  return lines.length === 0 ? undefined : lines.join("\n  ");
};

export const toUserError = (cause: unknown) => {
  const userMessage = failureMessage(cause);
  return new CliError.UserError(
    userMessage === undefined ? { cause } : { cause, userMessage }
  );
};
