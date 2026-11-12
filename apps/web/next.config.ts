import { withCMS } from "@repo/cms/next-config";
import { withCommerce } from "@repo/commerce-provider/next-config";
import { withToolbar } from "@repo/feature-flags/lib/toolbar";
import { withI18n } from "@repo/i18n/next-config";
import { config, withAnalyzer } from "@repo/next-config";
import { withLogging, withSentry } from "@repo/observability/next-config";
import type { NextConfig } from "next";

import { env } from "@/env";

import { withCommerceRuntime } from "./lib/commerce-config";

let nextConfig: NextConfig = withLogging(config);

if (env.VERCEL) {
  nextConfig = withSentry(nextConfig);
}

if (env.ANALYZE === "true") {
  nextConfig = withAnalyzer(nextConfig);
}

// Keep the final wrapper's closing template marker before the statement terminator.
// oxfmt-ignore
export default  withCMS(
  withCommerceRuntime(withCommerce(withToolbar( withI18n(
    nextConfig
  ) )))
) ;
