import { createHash } from "node:crypto";

import { expect } from "@effect/vitest";
import { CommerceBusinessUnitId } from "@repo/commerce-core/domain/commerce-account";
import { Layer, Redacted, Schema } from "effect";

import { ShopifyCompanyAdmin } from "../company/admin";
import { CompanyRoleBindings } from "../company/keys";
import { companyMemberProvisioningLayerWith } from "../company/provisioning";
import { companyStorageLayer } from "../company/storage";

export const companyId = "gid://shopify/Company/1";
export const locationId = CommerceBusinessUnitId.make(
  "gid://shopify/CompanyLocation/1"
);
export const buyerRoleId = "gid://shopify/CompanyContactRole/1";
export const bindings = Schema.decodeSync(CompanyRoleBindings)([
  {
    adminRoleIds: ["gid://shopify/CompanyContactRole/2"],
    buyerRoleId,
    companyId,
  },
]);
export const input = {
  acceptedIdentity: {
    authUserId: "user-1",
    email: Redacted.make("buyer@example.com"),
    firstName: Redacted.make("Buyer"),
    lastName: Redacted.make("One"),
  },
  businessUnitId: locationId,
  roles: ["buyer"] as const,
};
const string = (value: Schema.Json | undefined) =>
  Schema.decodeUnknownSync(Schema.String)(value);
type Customer = {
  id: string;
  email: string;
  contact?: { id: string; companyId: string; roles: Map<string, string> };
};
const customerJson = (customer: Customer) => ({
  companyContactProfiles: customer.contact
    ? [
        {
          company: { id: customer.contact.companyId },
          id: customer.contact.id,
          roleAssignments: {
            nodes: [...customer.contact.roles].map(([location, role]) => ({
              companyLocation: { id: location },
              role: { id: role },
            })),
            pageInfo: { hasNextPage: false },
          },
        },
      ]
    : [],
  defaultEmailAddress: { emailAddress: customer.email },
  id: customer.id,
});
export const fixture = () => {
  const customers = new Map<string, Customer>();
  const metafields = new Map<
    string,
    { key: string; value: string; compareDigest: string }
  >();
  const writes: string[] = [];
  const namespaces: string[] = [];
  let loseAssignment = false;
  let loseCreation = false;
  let loseRevocation = false;
  let createdCompany:
    | {
        id: string;
        externalId: string;
        locations: {
          nodes: { id: string; externalId: string }[];
          pageInfo: { hasNextPage: boolean };
        };
        contactRoles: {
          nodes: { id: string }[];
          pageInfo: { hasNextPage: boolean };
        };
      }
    | undefined;
  const nativeInputs: Schema.Json[] = [];

  const admin = ShopifyCompanyAdmin.layerWith(
    {
      SHOPIFY_ADMIN_ACCESS_TOKEN: "test-admin",
      SHOPIFY_STORE_DOMAIN: "test.myshopify.com",
    },
    // oxlint-disable-next-line complexity -- This native HTTP fixture dispatches independent GraphQL operations used by the company workflow tests.
    async (_url, init) => {
      expect(init?.cache).toBe("no-store");
      const { query, variables } = Schema.decodeUnknownSync(
        Schema.fromJsonString(
          Schema.Struct({
            query: Schema.String,
            variables: Schema.Record(Schema.String, Schema.Json),
          })
        )
      )(await new Response(init?.body).text());
      let data: Schema.Json;
      if (query.includes("CompanyStorageRead")) {
        const namespace = string(variables.namespace);
        data = {
          shop: {
            id: "gid://shopify/Shop/1",
            metafield:
              metafields.get(`${namespace}/${string(variables.key)}`) ?? null,
          },
        };
      } else if (query.includes("CompanyStorageValues")) {
        const namespace = string(variables.namespace);
        data = {
          shop: {
            metafields: {
              nodes: [...metafields]
                .filter(([key]) => key.startsWith(`${namespace}/`))
                .map(([, field]) => field),
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        };
      } else if (query.includes("CompanyStorageWrite")) {
        const [field] = Schema.decodeUnknownSync(
          Schema.Array(
            Schema.Struct({
              compareDigest: Schema.NullOr(Schema.String),
              key: Schema.String,
              namespace: Schema.String,
              value: Schema.String,
            })
          )
        )(variables.metafields);
        if (!field) {
          throw new Error("Missing fixture field");
        }
        const key = `${field.namespace}/${field.key}`;
        const previous = metafields.get(key);
        if ((previous?.compareDigest ?? null) === field.compareDigest) {
          namespaces.push(field.namespace);
          metafields.set(key, {
            compareDigest: createHash("sha256")
              .update(field.value)
              .digest("hex"),
            key: field.key,
            value: field.value,
          });
          data = { metafieldsSet: { userErrors: [] } };
        } else {
          data = {
            metafieldsSet: {
              userErrors: [{ code: "STALE_OBJECT", message: "stale" }],
            },
          };
        }
      } else if (query.includes("RegistrationCompanyCreate")) {
        const fields = Schema.decodeUnknownSync(
          Schema.Struct({
            company: Schema.Struct({ externalId: Schema.String }),
            companyContact: Schema.optionalKey(
              Schema.Struct({ email: Schema.String })
            ),
          })
        )(variables.input);
        createdCompany = {
          contactRoles: {
            nodes: [
              { id: buyerRoleId },
              { id: "gid://shopify/CompanyContactRole/2" },
            ],
            pageInfo: { hasNextPage: false },
          },
          externalId: fields.company.externalId,
          id: companyId,
          locations: {
            nodes: [{ id: locationId, externalId: fields.company.externalId }],
            pageInfo: { hasNextPage: false },
          },
        };
        if (fields.companyContact) {
          customers.set(fields.companyContact.email, {
            id: `gid://shopify/Customer/${customers.size + 1}`,
            email: fields.companyContact.email,
            contact: {
              id: "gid://shopify/CompanyContact/1",
              companyId,
              roles: new Map(),
            },
          });
        }
        nativeInputs.push(variables.input ?? null);
        writes.push("company-create");
        if (loseCreation) {
          loseCreation = false;
          throw new Error("Lost company creation response after commit");
        }
        data = { companyCreate: { company: createdCompany, userErrors: [] } };
      } else if (query.includes("RegisteredCompanyRecovery")) {
        data = {
          companies: {
            nodes: createdCompany ? [createdCompany] : [],
            pageInfo: { hasNextPage: false },
          },
        };
      } else if (query.includes("RegistrationLocation")) {
        data = {
          companyLocation: {
            company: { id: companyId },
            id: variables.id ?? "",
          },
        };
      } else if (query.includes("CompanyCustomer")) {
        const customer = [...customers.values()].find(
          (customer) => customer.id === variables.id
        );
        data = { customer: customer ? customerJson(customer) : null };
      } else if (query.includes("CompanyMemberRoster")) {
        data = {
          companyLocation: {
            company: { id: companyId },
            id: variables.id ?? "",
            roleAssignments: {
              nodes: [...customers.values()].flatMap((customer) =>
                [...(customer.contact?.roles ?? [])]
                  .filter(([location]) => location === variables.id)
                  .map(([location, role]) => ({
                    id: `assignment:${customer.id}:${location}`,
                    updatedAt: "2026-10-23T00:00:00Z",
                    role: { id: role },
                    companyContact: {
                      id: customer.contact?.id ?? "",
                      customer: {
                        ...customerJson(customer),
                        firstName: "Test",
                        lastName: "Member",
                      },
                    },
                  }))
              ),
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        };
      } else if (query.includes("CompanyMemberRevoke")) {
        const customer = [...customers.values()].find(
          (customer) => customer.contact?.id === variables.contactId
        );
        const location = [...(customer?.contact?.roles ?? [])].find(
          ([location]) =>
            `assignment:${customer?.id}:${location}` === variables.assignmentId
        )?.[0];
        if (!customer?.contact || !location) {
          throw new Error("Fixture assignment was not found");
        }
        customer.contact.roles.delete(location);
        writes.push("revoke");
        if (loseRevocation) {
          loseRevocation = false;
          throw new Error("Lost revoke response after commit");
        }
        data = {
          companyContactRevokeRole: {
            revokedCompanyContactRoleAssignmentId: variables.assignmentId ?? "",
            userErrors: [],
          },
        };
      } else if (query.includes("InvitationCompanyLocation")) {
        data = {
          companyLocation: {
            company: {
              contactRoles: {
                nodes: [
                  { id: buyerRoleId },
                  { id: "gid://shopify/CompanyContactRole/2" },
                ],
                pageInfo: { hasNextPage: false },
              },
              id: companyId,
            },
            id: variables.id ?? "",
          },
        };
      } else if (query.includes("InvitationCustomer")) {
        const email = Schema.decodeUnknownSync(
          Schema.fromJsonString(Schema.String)
        )(string(variables.query).slice(6));
        const customer = customers.get(email);
        data = {
          customers: {
            nodes: customer ? [customerJson(customer)] : [],
            pageInfo: { hasNextPage: false },
          },
        };
      } else if (query.includes("InvitationContactCreate")) {
        const person = Schema.decodeUnknownSync(
          Schema.Struct({ email: Schema.String })
        )(variables.input);
        const customer: Customer = {
          contact: {
            companyId: string(variables.companyId),
            id: "gid://shopify/CompanyContact/1",
            roles: new Map(),
          },
          email: person.email,
          id: `gid://shopify/Customer/${customers.size + 1}`,
        };
        customers.set(person.email, customer);
        writes.push("create");
        data = {
          companyContactCreate: {
            companyContact: { id: customer.contact?.id ?? "" },
            userErrors: [],
          },
        };
      } else if (
        query.includes("InvitationContactLink") ||
        query.includes("RegistrationContactLink")
      ) {
        const customer = [...customers.values()].find(
          ({ id }) => id === variables.customerId
        );
        if (!customer) {
          throw new Error("Missing fixture customer");
        }
        customer.contact = {
          companyId: string(variables.companyId),
          id: "gid://shopify/CompanyContact/1",
          roles: new Map(),
        };
        writes.push("link");
        data = {
          companyAssignCustomerAsContact: {
            companyContact: { id: customer.contact.id },
            userErrors: [],
          },
        };
      } else if (
        query.includes("InvitationLocationAssign") ||
        query.includes("RegistrationAdministratorAssign")
      ) {
        const contact = [...customers.values()].find(
          (customer) => customer.contact?.id === variables.contactId
        )?.contact;
        if (!contact) {
          throw new Error("Missing fixture contact");
        }
        contact.roles.set(
          string(variables.locationId),
          string(variables.roleId)
        );
        writes.push("assign");
        if (loseAssignment) {
          loseAssignment = false;
          throw new Error("Lost response after commit");
        }
        data = {
          companyContactAssignRole: {
            companyContactRoleAssignment: { id: "assignment-1" },
            userErrors: [],
          },
        };
      } else {
        throw new Error(`Unexpected fixture query ${query}`);
      }
      return Response.json({ data });
    }
  );
  const store = companyStorageLayer("identities").pipe(Layer.provide(admin));
  const layer = companyMemberProvisioningLayerWith(bindings).pipe(
    Layer.provide(store),
    Layer.provide(admin)
  );
  return {
    admin,
    customers,
    layer,
    loseAssignment: () => {
      loseAssignment = true;
    },
    loseCreation: () => {
      loseCreation = true;
    },
    loseRevocation: () => {
      loseRevocation = true;
    },
    namespaces,
    nativeInputs,
    store,
    writes,
  };
};
