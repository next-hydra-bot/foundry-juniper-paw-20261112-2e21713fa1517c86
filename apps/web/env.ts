import { keys } from "@repo/auth/keys";
import { keys as cms } from "@repo/cms/keys";
import { keys as commerce } from "@repo/commerce-provider/keys";
import { keys as flags } from "@repo/feature-flags/keys";
import { keys as core } from "@repo/next-config/keys";
import { configurePortlessEnvironment } from "@repo/next-config/portless";
import { keys as observability } from "@repo/observability/keys";
import { keys as rateLimit } from "@repo/rate-limit/keys";
import { keys as security } from "@repo/security/keys";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { webClientEnvFields, webServerEnvFields } from "./env-schema";

configurePortlessEnvironment("web");

export const env = createEnv({
  client: { ...webClientEnvFields, NEXT_PUBLIC_WEB_URL: z.string().url() },
  extends: [
    cms(),

    keys(),
    commerce(),
    core(),
    flags(),

    observability(),
    security(),
    rateLimit(),
  ],
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    VERCEL: process.env.VERCEL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
    CMS_HOMEPAGE_SLUG: process.env.CMS_HOMEPAGE_SLUG,
    REVALIDATION_SECRET: process.env.REVALIDATION_SECRET,
  },
  server: {
    ...webServerEnvFields,
    ANALYZE: z.string().optional(),
    VERCEL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  },
});
