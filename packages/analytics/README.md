# Analytics setup

PostHog is optional. When either `NEXT_PUBLIC_POSTHOG_KEY` or `NEXT_PUBLIC_POSTHOG_HOST` is missing, PostHog is not initialized and PostHog feature flags use their default values. Other analytics integrations are unaffected.

To enable PostHog, set both the project key and host in the web application's environment before starting it. Copy the values from your project settings; do not use a personal API key in the public project-key variable. Restart development or redeploy after changing application environment values.

`NEXT_PUBLIC_GA_MEASUREMENT_ID` is optional. The Google Analytics component is only rendered when that value is configured. The analytics provider also includes Vercel Analytics.

Composition displays these configuration steps; it does not create a PostHog project or configure the external service.
