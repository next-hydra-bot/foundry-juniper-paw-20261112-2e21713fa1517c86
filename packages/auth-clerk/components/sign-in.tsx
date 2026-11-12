import { SignIn as ClerkSignIn } from "@clerk/nextjs";

export interface SignInProps {
  readonly fallbackRedirectUrl?: string;
  readonly path?: string;
  readonly signUpUrl?: string;
}

export const SignIn = ({
  fallbackRedirectUrl,
  path,
  signUpUrl,
}: SignInProps) => (
  <ClerkSignIn
    appearance={{
      elements: {
        header: "hidden",
        rootBox: "mx-auto",
      },
    }}
    fallbackRedirectUrl={fallbackRedirectUrl}
    signUpUrl={signUpUrl}
    {...(path ? { path, routing: "path" } : { routing: "hash" })}
  />
);
