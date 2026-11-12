import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    runtimeEnv: {
      SHOPIFY_BUYER_IP_HEADER: process.env.SHOPIFY_BUYER_IP_HEADER,
      SHOPIFY_STOREFRONT_API_VERSION:
        process.env.SHOPIFY_STOREFRONT_API_VERSION,
      SHOPIFY_STOREFRONT_PRIVATE_TOKEN:
        process.env.SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
      SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    },
    server: {
      SHOPIFY_BUYER_IP_HEADER: z
        .string()
        .regex(/^[a-z0-9-]+$/u)
        .default("x-vercel-forwarded-for"),
      SHOPIFY_STOREFRONT_API_VERSION: z
        .string()
        .regex(/^\d{4}-(?:01|04|07|10)$/u)
        .default("2026-10"),
      SHOPIFY_STOREFRONT_PRIVATE_TOKEN: z.string().min(1),
      SHOPIFY_STORE_DOMAIN: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u),
    },
  });
