import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { makeCatalogAdmin } from "../catalog/admin";
import { provisionStoreAttribution } from "./store-attribution";

const nativeDefinition = (enabled = true, type = "single_line_text_field") => ({
  capabilities: {
    adminFilterable: { enabled },
    cartToOrderCopyable: { enabled },
  },
  id: "gid://shopify/MetafieldDefinition/1",
  key: "store_key",
  namespace: "commerce",
  ownerType: "ORDER",
  type: { name: type },
});
const RequestBody = Schema.fromJsonString(
  Schema.Struct({
    query: Schema.String,
    variables: Schema.Record(Schema.String, Schema.Json),
  })
);
const fixture = (
  initial: ReturnType<typeof nativeDefinition> | null = null
) => {
  let definition = initial;
  let dropWrite = false;
  const writes: Schema.Json[] = [];
  const fetchApi: typeof fetch = async (input, init) => {
    const body = Schema.decodeSync(RequestBody)(
      await new globalThis.Request(input, init).text()
    );
    if (body.query.includes("query StoreAttributionDefinition")) {
      expect(body.variables.identifier).toEqual({
        key: "store_key",
        namespace: "commerce",
        ownerType: "ORDER",
      });
      return Response.json({ data: { metafieldDefinition: definition } });
    }
    writes.push(body.variables.definition ?? null);
    definition = nativeDefinition();
    if (dropWrite) {
      dropWrite = false;
      throw new Error("Response lost after Shopify accepted the write");
    }
    const create = body.query.includes("metafieldDefinitionCreate(");
    expect(
      create || body.query.includes("metafieldDefinitionUpdate(")
    ).toBeTruthy();
    return Response.json({
      data: {
        [create ? "metafieldDefinitionCreate" : "metafieldDefinitionUpdate"]: {
          [create ? "createdDefinition" : "updatedDefinition"]: definition,
          userErrors: [],
        },
      },
    });
  };
  return {
    admin: makeCatalogAdmin(
      Effect.succeed({
        domain: "example.myshopify.com",
        token: "private-admin-token",
      }),
      fetchApi
    ),
    dropNextWrite: () => {
      dropWrite = true;
    },
    writes,
  };
};

describe("Store attribution provisioning", () => {
  it.effect(
    "creates a copyable and filterable Order definition and verifies its tracked ID",
    () =>
      Effect.gen(function* () {
        const target = fixture();
        const id = yield* provisionStoreAttribution(target.admin);
        expect(id).toBe(nativeDefinition().id);
        expect(yield* provisionStoreAttribution(target.admin, id)).toBe(id);
        expect(target.writes).toHaveLength(1);
        expect(target.writes[0]).toMatchObject({
          capabilities: {
            adminFilterable: { enabled: true },
            cartToOrderCopyable: { enabled: true },
          },
          key: "store_key",
          namespace: "commerce",
          ownerType: "ORDER",
          type: "single_line_text_field",
        });
      })
  );

  it.effect(
    "rejects an existing Order definition without a tracking record",
    () =>
      Effect.gen(function* () {
        const target = fixture(nativeDefinition());
        expect(
          yield* provisionStoreAttribution(target.admin).pipe(Effect.isFailure)
        ).toBeTruthy();
        expect(target.writes).toHaveLength(0);
      })
  );

  it.effect(
    "enables capabilities on a matching definition without replacing its other settings",
    () =>
      Effect.gen(function* () {
        const target = fixture(nativeDefinition(false));
        expect(
          yield* provisionStoreAttribution(target.admin, nativeDefinition().id)
        ).toBe(nativeDefinition().id);
        expect(target.writes).toEqual([
          {
            capabilities: {
              adminFilterable: { enabled: true },
              cartToOrderCopyable: { enabled: true },
            },
            key: "store_key",
            namespace: "commerce",
            ownerType: "ORDER",
          },
        ]);
      })
  );

  it.effect("rejects an incompatible existing definition before writing", () =>
    Effect.gen(function* () {
      const target = fixture(nativeDefinition(true, "json"));
      const failure = yield* provisionStoreAttribution(
        target.admin,
        nativeDefinition().id
      ).pipe(Effect.flip);
      expect(failure.message).toContain("incompatible");
      expect(target.writes).toHaveLength(0);
    })
  );

  it.effect("never claims an Order definition after an uncertain write", () =>
    Effect.gen(function* () {
      const target = fixture();
      target.dropNextWrite();
      const failure = yield* provisionStoreAttribution(target.admin).pipe(
        Effect.flip
      );
      expect(failure.message).not.toContain("private-admin-token");
      expect(target.writes).toHaveLength(1);
      expect(
        yield* provisionStoreAttribution(target.admin).pipe(Effect.isFailure)
      ).toBeTruthy();
      expect(target.writes).toHaveLength(1);
    })
  );
});
