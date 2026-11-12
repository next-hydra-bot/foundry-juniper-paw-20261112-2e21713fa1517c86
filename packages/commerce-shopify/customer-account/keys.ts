import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/** Required by authenticated customer-session recipes and the commerce HTTP API. */
export const customerAccountKeys = () =>
  createEnv({
    runtimeEnv: {
      SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID:
        process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
      SHOPIFY_CUSTOMER_SESSION_SECRET:
        process.env.SHOPIFY_CUSTOMER_SESSION_SECRET,
      SHOPIFY_SHOP_ID: process.env.SHOPIFY_SHOP_ID,
      SHOPIFY_STOREFRONT_ORIGIN: process.env.SHOPIFY_STOREFRONT_ORIGIN,
    },
    server: {
      SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: z.string().min(1),
      SHOPIFY_CUSTOMER_SESSION_SECRET: z.string().min(32),
      SHOPIFY_SHOP_ID: z.string().regex(/^\d+$/u),
      SHOPIFY_STOREFRONT_ORIGIN: z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return url.protocol === "https:" && url.origin === value;
        }),
    },
  });
