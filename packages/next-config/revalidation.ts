import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

const tag = z.string().min(1).max(256);
const pathname = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.includes("?") &&
      !value.includes("#"),
    "Use a local pathname without a query or fragment"
  );
const path = z.union([
  pathname
    .refine(
      (value) => !value.includes("[") && !value.includes("]"),
      "Route patterns require a page or layout type"
    )
    .transform((value) => ({ path: value, type: undefined })),
  z.object({ path: pathname, type: z.enum(["page", "layout"]) }).strict(),
]);
const payload = z
  .object({
    tags: z.array(tag).max(32).default([]),
    paths: z.array(path).max(32).default([]),
  })
  .strict()
  .refine(
    (value) => value.tags.length + value.paths.length > 0,
    "Supply tags or paths"
  );

type Revalidation = z.infer<typeof payload>;

export interface RevalidationOperations {
  readonly revalidateTag: (tag: string, profile: { expire: number }) => void;
  readonly revalidatePath: (path: string, type?: "page" | "layout") => void;
}

const secretsMatch = (provided: string | null, configured: string) => {
  if (!provided) {
    return false;
  }
  const actual = Buffer.from(provided);
  const expected = Buffer.from(configured);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

const readPost = async (request: Request): Promise<Revalidation | null> => {
  try {
    const body: unknown = await request.json();
    const decoded = payload.safeParse(body);
    return decoded.success ? decoded.data : null;
  } catch {
    return null;
  }
};

const readQuery = (url: URL): Revalidation | null => {
  const values = (name: string) =>
    url.searchParams
      .getAll(name)
      .flatMap((value) => value.split(",").map((item) => item.trim()));
  const decoded = payload.safeParse({
    tags: values("tags"),
    paths: values("paths"),
  });
  return decoded.success ? decoded.data : null;
};

/** One authenticated cache endpoint for CMS callbacks and backend integrations. */
export const createRevalidationHandler =
  (options: {
    readonly secret: () => string | undefined;
    readonly operations: RevalidationOperations;
  }) =>
  async (request: Request): Promise<Response> => {
    const secret = options.secret();
    if (!secret) {
      return Response.json(
        { error: "Cache revalidation is not configured" },
        { status: 503 }
      );
    }
    const url = new URL(request.url);
    const authorization = request.headers.get("authorization");
    let supplied: string | null = null;
    if (authorization?.startsWith("Bearer ")) {
      supplied = authorization.slice(7);
    } else if (request.method !== "POST") {
      supplied = url.searchParams.get("secret");
    }
    if (!secretsMatch(supplied, secret)) {
      return Response.json(
        { error: "Invalid revalidation secret" },
        { status: 401 }
      );
    }
    const decoded =
      request.method === "POST" ? await readPost(request) : readQuery(url);
    if (!decoded) {
      return Response.json(
        { error: "Supply valid cache tags or paths" },
        { status: 400 }
      );
    }
    const tags = [...new Set(decoded.tags)];
    const paths = [
      ...new Map(
        decoded.paths.map((value) => [
          `${value.type ?? "url"}:${value.path}`,
          value,
        ])
      ).values(),
    ];
    for (const value of tags) {
      options.operations.revalidateTag(value, { expire: 0 });
    }
    for (const value of paths) {
      if (value.type === undefined) {
        options.operations.revalidatePath(value.path);
      } else {
        options.operations.revalidatePath(value.path, value.type);
      }
    }
    return Response.json({ revalidated: true, tags, paths });
  };
