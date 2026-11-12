import { SignUp as ClerkSignUp } from "@clerk/nextjs";

export const signUpPath = "/sign-up";

export interface SignUpProps {
  readonly fallbackRedirectUrl?: string;
  readonly path?: string;
  readonly signInUrl?: string;
}

export const SignUp = ({
  fallbackRedirectUrl,
  path,
  signInUrl,
}: SignUpProps) => (
  <ClerkSignUp
    appearance={{
      elements: {
        header: "hidden",
        rootBox: "mx-auto",
      },
    }}
    fallbackRedirectUrl={fallbackRedirectUrl}
    signInUrl={signInUrl}
    {...(path ? { path, routing: "path" } : { routing: "hash" })}
  />
);
