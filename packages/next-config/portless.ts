const AUTH_CALLBACK_PATH = "/api/auth/callback";
const PORTLESS_ROUTE_LABELS_AFTER_APPLICATION = 2;

export type PortlessApplication = "admin" | "api" | "web";

const serviceUrl = (
  portlessUrl: string,
  currentApplication: PortlessApplication,
  targetApplication: PortlessApplication
): string | undefined => {
  try {
    const url = new URL(portlessUrl);
    const hostnameLabels = url.hostname.split(".");
    const applicationLabel =
      hostnameLabels.length - PORTLESS_ROUTE_LABELS_AFTER_APPLICATION - 1;

    if (hostnameLabels[applicationLabel] !== currentApplication) {
      return undefined;
    }

    hostnameLabels[applicationLabel] = targetApplication;
    url.hostname = hostnameLabels.join(".");
    url.pathname = "/";
    url.search = "";
    url.hash = "";

    return url.origin;
  } catch {
    return undefined;
  }
};

const callbackUrl = (origin: string): string =>
  new URL(AUTH_CALLBACK_PATH, origin).href;

export const configurePortlessEnvironment = (
  currentApplication: PortlessApplication
): void => {
  const currentUrl = process.env.PORTLESS_URL;

  if (!currentUrl || process.env.PORTLESS_AUTO_ENV === "0") {
    return;
  }

  const adminUrl = serviceUrl(currentUrl, currentApplication, "admin");
  const apiUrl = serviceUrl(currentUrl, currentApplication, "api");
  const webUrl = serviceUrl(currentUrl, currentApplication, "web");

  if (!(adminUrl && apiUrl && webUrl)) {
    return;
  }

  const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL;
  // The sample origin follows the active worktree just like an unset value.
  const defaultApiHost = new URL(apiUrl).hostname
    .split(".")
    .slice(-(PORTLESS_ROUTE_LABELS_AFTER_APPLICATION + 1))
    .join(".");
  const useSiblingApi =
    !configuredApiUrl ||
    (URL.canParse(configuredApiUrl) &&
      new URL(configuredApiUrl).hostname === defaultApiHost);
  const authUrl = currentApplication === "admin" ? adminUrl : webUrl;

  // Next.js inlines direct NEXT_PUBLIC_* references during production builds.
  Object.assign(process.env, {
    ADMIN_CLERK_AUTHORIZED_PARTIES: adminUrl,
    ADMIN_URL: adminUrl,
    CLERK_AUTHORIZED_PARTIES: authUrl,
    NEXT_PUBLIC_API_URL: useSiblingApi ? apiUrl : configuredApiUrl,
    NEXT_PUBLIC_WEB_URL: webUrl,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: callbackUrl(authUrl),
    VERCEL_PROJECT_PRODUCTION_URL: new URL(currentUrl).host,
  });
};
