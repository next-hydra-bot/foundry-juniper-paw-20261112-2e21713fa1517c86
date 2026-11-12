import { z } from "zod";

export const MINIMUM_REVALIDATION_SECRET_LENGTH = 32;

export const webServerEnvFields = {
  CMS_HOMEPAGE_SLUG: z.string().trim().min(1).default("/"),
  REVALIDATION_SECRET: z
    .string()
    .min(MINIMUM_REVALIDATION_SECRET_LENGTH)
    .optional(),
};

export const webServerEnvSchema = z.object(webServerEnvFields);

export const webClientEnvFields = {};

export const webClientEnvSchema = z.object(webClientEnvFields);
