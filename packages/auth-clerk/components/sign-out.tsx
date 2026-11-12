"use client";

import { SignOutButton, useAuth, useClerk } from "@clerk/nextjs";
import { Effect } from "effect";
import { useState } from "react";

import { signOutWithPreparation } from "../sign-out";

export interface SignOutProps {
  readonly redirectUrl?: string;
  readonly prepareSignOutAction?: () => Promise<void>;
}

export function useSignOut({
  redirectUrl = "/",
  prepareSignOutAction,
}: SignOutProps) {
  const clerk = useClerk();
  const { isLoaded, sessionId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const disabled = busy || !isLoaded || !sessionId;
  const signOut = async () => {
    if (disabled) {
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      if (!prepareSignOutAction) {
        await clerk.signOut({ redirectUrl });
        return;
      }
      await Effect.runPromise(
        signOutWithPreparation({
          prepare: prepareSignOutAction,
          readSessionId: () => clerk.session?.id,
          redirectUrl,
          signOut: async (input) => {
            await clerk.signOut(
              () => {
                // Shopify logout needs a full document navigation.
                window.location.assign(input.redirectUrl);
              },
              { sessionId: input.sessionId }
            );
          },
        })
      );
    } catch {
      setBusy(false);
      setFailed(true);
    }
  };
  return { busy, disabled, failed, signOut };
}

function PreparedSignOut(props: SignOutProps) {
  const { busy, disabled, failed, signOut } = useSignOut(props);
  return (
    <>
      <button
        disabled={disabled}
        onClick={() => {
          void signOut();
        }}
        type="button"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <p role="alert">Sign-out could not be completed. Please try again.</p>
      ) : null}
    </>
  );
}

export const SignOut = (props: SignOutProps) =>
  props.prepareSignOutAction ? (
    <PreparedSignOut
      {...props}
      prepareSignOutAction={props.prepareSignOutAction}
    />
  ) : (
    <SignOutButton redirectUrl={props.redirectUrl ?? "/"} />
  );
