import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export interface ShopifyAdminEnvironment {
  readonly SHOPIFY_ADMIN_ACCESS_TOKEN?: string | undefined;
  readonly SHOPIFY_ADMIN_CLIENT_ID?: string | undefined;
  readonly SHOPIFY_ADMIN_CLIENT_SECRET?: string | undefined;
  readonly SHOPIFY_STORE_DOMAIN: string;
}

export const adminKeys = () =>
  createEnv({
    emptyStringAsUndefined: true,
    runtimeEnv: {
      SHOPIFY_ADMIN_ACCESS_TOKEN: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      SHOPIFY_ADMIN_CLIENT_ID: process.env.SHOPIFY_ADMIN_CLIENT_ID,
      SHOPIFY_ADMIN_CLIENT_SECRET: process.env.SHOPIFY_ADMIN_CLIENT_SECRET,
      SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    },
    server: {
      SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().min(1).optional(),
      SHOPIFY_ADMIN_CLIENT_ID: z.string().min(1).optional(),
      SHOPIFY_ADMIN_CLIENT_SECRET: z.string().min(1).optional(),
      SHOPIFY_STORE_DOMAIN: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u),
    },
  });
