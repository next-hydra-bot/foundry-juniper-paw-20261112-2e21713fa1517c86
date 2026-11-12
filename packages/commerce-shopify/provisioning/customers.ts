import { createHash } from "node:crypto";

import type {
  ProvisionedResource,
  ProvisioningReferences,
} from "@repo/cli-core/json-migrations";
import type { CustomerInput } from "@repo/commerce-core/domain/customer";
import { Customer } from "@repo/commerce-core/domain/customer";
import { Effect, Redacted, Schema } from "effect";
import { DestinationError } from "migrate-sdk";

// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- This is a plain provider HTTP client used by a migration destination.
import { journalCatalogAdmin, makeCatalogAdmin } from "../catalog/admin";
import type { CatalogSettings } from "../catalog/destination";

const NativeCustomer = Schema.Struct({
  email: Schema.NonEmptyString,
  firstName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  lastName: Schema.NullOr(Schema.String),
  metafield: Schema.NullOr(Schema.Struct({ value: Schema.String })),
  tags: Schema.Array(Schema.String),
});
const fields =
  'id email firstName lastName tags metafield(namespace:"app_provisioning",key:"customer_key") { value }';
type NativeProvisioningCustomerInput = {
  readonly email: string;
  firstName?: string;
  lastName?: string;
};
const fail = () =>
  new DestinationError({
    message:
      "Shopify customer provisioning failed; check permissions, source ownership and customer conflicts.",
  });

/** Uses a native metafield for the source key; email never selects an existing owner. */
export const makeCustomerDestination = (
  settings: Effect.Effect<
    Pick<CatalogSettings, "domain" | "token">,
    DestinationError
  >,
  fetchApi: typeof fetch = globalThis.fetch
) => {
  const admin = journalCatalogAdmin(makeCatalogAdmin(settings, fetchApi));
  const write = Effect.fn("Shopify.provisionCustomer")(function* (
    input: CustomerInput,
    _references?: ProvisioningReferences,
    previous?: ProvisionedResource
  ) {
    const tag = `provision-customer-${createHash("sha256").update(input.key).digest("hex")}`;
    if (previous) {
      const found = yield* admin.request(
        "Read tracked Customer",
        `query ProvisionCustomerById($id:ID!) { customer(id:$id) { ${fields} } }`,
        { id: previous.id }
      );
      const existing = yield* Schema.decodeUnknownEffect(NativeCustomer)(
        found.customer
      ).pipe(Effect.mapError(fail));
      if (
        existing.id !== previous.id ||
        existing.metafield?.value !== input.key ||
        !existing.tags.includes(tag)
      ) {
        return yield* fail();
      }
    } else {
      const found = yield* admin.request(
        "Check Shopify Customer key",
        `query ProvisionCustomers($query:String!) { customers(first:2,query:$query) { nodes { id } pageInfo { hasNextPage } } }`,
        { query: `tag:${tag}` }
      );
      const connection = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          nodes: Schema.Array(Schema.Struct({ id: Schema.String })),
          pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
        })
      )(found.customers).pipe(Effect.mapError(fail));
      if (connection.pageInfo.hasNextPage || connection.nodes.length > 0) {
        return yield* fail();
      }
    }
    const data: NativeProvisioningCustomerInput = {
      email: Redacted.value(input.email),
    };
    if (input.firstName !== undefined) {
      data.firstName = Redacted.value(input.firstName);
    }
    if (input.lastName !== undefined) {
      data.lastName = Redacted.value(input.lastName);
    }
    const operation = previous ? "customerUpdate" : "customerCreate";
    const payload = previous
      ? yield* admin.mutation(
          operation,
          `mutation ProvisionCustomer($input:CustomerInput!) { customerUpdate(input:$input) { customer { ${fields} } userErrors { message } } }`,
          { input: { ...data, id: previous.id } }
        )
      : yield* admin.mutation(
          operation,
          `mutation ProvisionCustomer($input:CustomerInput!) { customerCreate(input:$input) { customer { ${fields} } userErrors { message } } }`,
          {
            input: {
              ...data,
              metafields: [
                {
                  key: "customer_key",
                  namespace: "app_provisioning",
                  type: "single_line_text_field",
                  value: input.key,
                },
              ],
              tags: [tag],
            },
          }
        );
    const customer = yield* Schema.decodeUnknownEffect(NativeCustomer)(
      payload.customer
    ).pipe(Effect.mapError(fail));
    if (
      customer.metafield?.value !== input.key ||
      !customer.tags.includes(tag) ||
      (previous !== undefined && customer.id !== previous.id)
    ) {
      return yield* fail();
    }
    return yield* Schema.decodeEffect(Schema.toCodecJson(Customer))({
      customerId: customer.id,
      email: customer.email,
      firstName: customer.firstName ?? "",
      key: input.key,
      lastName: customer.lastName ?? "",
    }).pipe(Effect.mapError(fail));
  });
  return {
    entity: Customer,
    reference: (customer: Customer) => ({
      id: customer.customerId,
      key: customer.key ?? "",
    }),
    write,
  };
};
