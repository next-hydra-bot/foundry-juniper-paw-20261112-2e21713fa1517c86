import { createHash } from "node:crypto";

import { expect, layer } from "@effect/vitest";
import { Customer, CustomerInput } from "@repo/commerce-core/domain/customer";
import { Effect, Schema } from "effect";

import { testTracking } from "../catalog/tracking.test-fixture";
import { makeCustomerDestination } from "./customers";

const input = Schema.decodeSync(Schema.toCodecJson(CustomerInput))({
  email: "shopper@example.com",
  firstName: "Alex",
  key: "Customer / 42",
  lastName: "Morgan",
});
const ownerTag = `provision-customer-${createHash("sha256").update(input.key).digest("hex")}`;
const fixture = (foreign = false) => {
  const writes: Schema.Json[] = [];
  let exists = foreign;
  let tags = [ownerTag];
  const customer = () => ({
    email: "shopper@example.com",
    firstName: "Alex",
    id: "gid://shopify/Customer/42",
    lastName: "Morgan",
    metafield: { value: foreign ? "another-source" : input.key },
    tags,
  });
  const fetcher: typeof fetch = async (request, init) => {
    const parsed = Schema.decodeSync(
      Schema.fromJsonString(
        Schema.Struct({
          query: Schema.String,
          variables: Schema.Record(Schema.String, Schema.Json),
        })
      )
    )(await new Request(request, init).text());
    if (parsed.query.startsWith("query ProvisionCustomerById")) {
      return Response.json({ data: { customer: exists ? customer() : null } });
    }
    if (parsed.query.startsWith("query")) {
      return Response.json({
        data: {
          customers: {
            nodes: exists ? [customer()] : [],
            pageInfo: { hasNextPage: false },
          },
        },
      });
    }
    writes.push(parsed.variables.input ?? null);
    const operation = exists ? "customerUpdate" : "customerCreate";
    if (exists) {
      tags = [...tags, "added-by-another-process"];
    }
    exists = true;
    return Response.json({
      data: { [operation]: { customer: customer(), userErrors: [] } },
    });
  };
  return {
    destination: makeCustomerDestination(
      Effect.succeed({
        domain: "fixtures.myshopify.com",
        token: "test-admin-secret",
      }),
      fetcher
    ),
    writes,
  };
};

layer(testTracking)("Domain provisioning", (it) => {
  it.effect(
    "maps the common Customer input into Shopify and preserves concurrent tags",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture();
        const first = yield* destination.write(input);
        yield* Schema.decodeUnknownEffect(Schema.toType(Customer))(first);
        const second = yield* destination.write(
          input,
          undefined,
          destination.reference(first)
        );
        expect(first).toMatchObject({
          customerId: "gid://shopify/Customer/42",
          key: input.key,
        });
        expect(second.customerId).toBe(first.customerId);
        expect(writes[0]).toMatchObject({
          metafields: [{ key: "customer_key", value: input.key }],
          tags: [ownerTag],
        });
        expect(writes[1]).toEqual({
          email: "shopper@example.com",
          firstName: "Alex",
          id: "gid://shopify/Customer/42",
          lastName: "Morgan",
        });
      })
  );

  it.effect(
    "rejects a mismatched source metafield without adopting the customer by email",
    () =>
      Effect.gen(function* () {
        const { destination, writes } = fixture(true);
        expect(yield* destination.write(input).pipe(Effect.flip)).toMatchObject(
          {
            _tag: "DestinationError",
          }
        );
        expect(writes).toEqual([]);
      })
  );
});
