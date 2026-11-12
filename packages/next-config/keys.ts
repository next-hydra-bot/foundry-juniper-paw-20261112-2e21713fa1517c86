import { vercel } from "@t3-oss/env-core/presets-zod";
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    client: {
      NEXT_PUBLIC_WEB_URL: z.string().url(),
    },
    extends: [vercel()],
    runtimeEnv: {
      ANALYZE: process.env.ANALYZE,
      NEXT_PUBLIC_WEB_URL: process.env.NEXT_PUBLIC_WEB_URL,
      NEXT_RUNTIME: process.env.NEXT_RUNTIME,
    },
    server: {
      ANALYZE: z.string().optional(),

      // Added by Vercel
      NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),
    },
  });

/** Optional fallback for registration calls without a private API binding. */
export const apiKeys = () =>
  createEnv({
    client: { NEXT_PUBLIC_API_URL: z.string().url().optional() },
    emptyStringAsUndefined: true,
    runtimeEnv: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL },
  });

const relatedProjectsSchema = z.array(
  z.object({
    project: z.object({ id: z.string() }),
    preview: z
      .object({
        branch: z.string().optional(),
        customEnvironment: z.string().optional(),
      })
      .optional(),
    production: z
      .object({ alias: z.string().optional(), url: z.string().optional() })
      .optional(),
  })
);

/** Resolve only configured Git preview links. Production keeps its explicit origin. */
export function relatedPreviewOrigin(
  projectIdKey: "RELATED_API_PROJECT_ID" | "RELATED_WEB_PROJECT_ID",
  environment: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
  const id = environment[projectIdKey];
  if (environment.VERCEL_ENV !== "preview" || !id) return undefined;

  let projects: unknown;
  try {
    projects = JSON.parse(environment.VERCEL_RELATED_PROJECTS ?? "null");
  } catch {
    throw new Error("Invalid Vercel Related Projects configuration.");
  }
  const decoded = relatedProjectsSchema.safeParse(projects);
  const related = decoded.success
    ? decoded.data.find(({ project }) => project.id === id)
    : undefined;
  const host = related?.preview?.customEnvironment ?? related?.preview?.branch;
  if (
    !host ||
    !/^[a-z\d.-]+\.[a-z\d]+$/iu.test(host) ||
    host.toLowerCase() === related?.production?.alias?.toLowerCase() ||
    host.toLowerCase() === related?.production?.url?.toLowerCase()
  ) {
    throw new Error(`No matching Vercel preview host for ${projectIdKey}.`);
  }
  return `https://${host}`;
}
