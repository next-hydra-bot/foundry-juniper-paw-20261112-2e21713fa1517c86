import type { NextConfig } from "next";

export const withCommerce = (config: NextConfig): NextConfig => ({
  ...config,
  images: {
    ...config.images,
    remotePatterns: [
      ...(config.images?.remotePatterns ?? []),
      { hostname: "cdn.shopify.com", protocol: "https" },
    ],
  },
});
