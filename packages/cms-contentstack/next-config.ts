import { getContentstackEndpoint } from "@contentstack/utils";
import type { NextConfig } from "next";

export const withCMS = (config: NextConfig): NextConfig => {
  const region = process.env.CONTENTSTACK_REGION ?? "NA";
  const regionalImageEndpoint = getContentstackEndpoint(region, "images");
  const imageHosts = new Set(["images.contentstack.io"]);
  if (typeof regionalImageEndpoint === "string") {
    imageHosts.add(new URL(regionalImageEndpoint).hostname);
  }

  return {
    ...config,
    allowedDevOrigins: [
      ...(config.allowedDevOrigins ?? []),
      "app.contentstack.com",
    ],
    images: {
      ...config.images,
      remotePatterns: [
        ...(config.images?.remotePatterns ?? []),
        ...Array.from(imageHosts, (hostname) => ({
          hostname,
          protocol: "https" as const,
        })),
      ],
    },
  };
};
