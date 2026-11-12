import { describe, expect, it, vi } from "vitest";

import { createRevalidationHandler } from "./revalidation";
import type { RevalidationOperations } from "./revalidation";

const secret = "shared-revalidation-secret";
const fixture = (configured: string | undefined = secret) => {
  const operations = {
    revalidatePath: vi.fn<RevalidationOperations["revalidatePath"]>(),
    revalidateTag: vi.fn<RevalidationOperations["revalidateTag"]>(),
  };
  return {
    handle: createRevalidationHandler({ operations, secret: () => configured }),
    operations,
  };
};
const post = (body: string, credential = secret) =>
  new Request("https://web.example.com/api/revalidate", {
    body,
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

describe("shared cache revalidation", () => {
  it("invalidates tags and paths through one authenticated request", async () => {
    const { handle, operations } = fixture();
    const response = await handle(
      post(
        JSON.stringify({
          tags: ["commerce:product-lists", "node:1", "node:1"],
          paths: ["/en/products", "/en/products"],
        })
      )
    );
    expect(response.status).toBe(200);
    expect(operations.revalidateTag).toHaveBeenCalledTimes(2);
    expect(operations.revalidateTag).toHaveBeenCalledWith(
      "commerce:product-lists",
      { expire: 0 }
    );
    expect(operations.revalidateTag).toHaveBeenCalledWith("node:1", {
      expire: 0,
    });
    expect(operations.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/en/products"
    );
  });

  it("supports explicitly typed page and layout patterns", async () => {
    const { handle, operations } = fixture();
    const response = await handle(
      post(
        JSON.stringify({
          paths: [
            { path: "/products/[slug]", type: "page" },
            { path: "/", type: "layout" },
          ],
        })
      )
    );
    expect(response.status).toBe(200);
    expect(operations.revalidatePath).toHaveBeenCalledWith(
      "/products/[slug]",
      "page"
    );
    expect(operations.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("accepts Drupal's native GET callback with the same secret", async () => {
    const { handle, operations } = fixture();
    const response = await handle(
      new Request(
        `https://web.example.com/api/revalidate?secret=${secret}&tags=node:1,node_list,node_list`
      )
    );
    expect(response.status).toBe(200);
    expect(operations.revalidateTag).toHaveBeenCalledTimes(2);
    expect(operations.revalidateTag).toHaveBeenCalledWith("node:1", {
      expire: 0,
    });
    expect(operations.revalidateTag).toHaveBeenCalledWith("node_list", {
      expire: 0,
    });
  });

  it("rejects missing or incorrect credentials before invalidating", async () => {
    const { handle, operations } = fixture();
    const unauthorized = await handle(post('{"tags":["products"]}', "wrong"));
    const missing = await handle(
      new Request("https://web.example.com/api/revalidate?tags=node:1")
    );
    expect(unauthorized.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(operations.revalidateTag).not.toHaveBeenCalled();
    expect(operations.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    "{",
    "{}",
    '{"tags":[""]}',
    '{"paths":["https://other.example/path"]}',
    '{"tags":["products"],"paths":["/products/[slug]"]}',
  ])(
    "rejects invalid input %s without partially invalidating",
    async (body) => {
      const { handle, operations } = fixture();
      const response = await handle(post(body));
      expect(response.status).toBe(400);
      expect(operations.revalidateTag).not.toHaveBeenCalled();
      expect(operations.revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("returns unavailable while the shared secret is unconfigured", async () => {
    const operations = {
      revalidatePath: vi.fn<RevalidationOperations["revalidatePath"]>(),
      revalidateTag: vi.fn<RevalidationOperations["revalidateTag"]>(),
    };
    const handle = createRevalidationHandler({
      operations,
      secret: () => undefined,
    });
    const response = await handle(post('{"tags":["products"]}'));
    expect(response.status).toBe(503);
    expect(operations.revalidateTag).not.toHaveBeenCalled();
  });
});
