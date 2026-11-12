import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Redacted, Schema } from "effect";

import {
  clerkOAuthFileLayer,
  makeClerkOAuthApi,
  provisionClerkOAuth,
} from "./oauth-provisioning";

const Input = Schema.Struct({
  consent_screen_enabled: Schema.Boolean,
  name: Schema.String,
  pkce_required: Schema.Boolean,
  public: Schema.Boolean,
  redirect_uris: Schema.Array(Schema.String),
  scopes: Schema.String,
});
const initial = {
  client_id: "client-1",
  consent_screen_enabled: false,
  discovery_url:
    "https://identity.example.com/.well-known/openid-configuration",
  id: "oauth-1",
  instance_id: "customer-instance",
  name: "Shopify sign-in",
  pkce_required: false,
  public: false,
  redirect_uris: ["https://shopify.com/existing/callback"],
  scopes: "openid email profile",
};
const fixture = (exists = false) => {
  let application: typeof initial | undefined = exists
    ? { ...initial }
    : undefined;
  let rejectDiscovery = false;
  const writes: string[] = [];
  const discoveryAuthorization: (string | null)[] = [];
  const fetchApi: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === "identity.example.com") {
      discoveryAuthorization.push(request.headers.get("authorization"));
      if (rejectDiscovery) {
        rejectDiscovery = false;
        return Response.json({ private: "oauth-secret" }, { status: 500 });
      }
      return Response.json({
        authorization_endpoint: "https://identity.example.com/authorize",
        issuer: "https://identity.example.com",
        jwks_uri: "https://identity.example.com/jwks",
        token_endpoint: "https://identity.example.com/token",
      });
    }
    expect(request.headers.get("authorization")).toBe(
      "Bearer clerk-api-secret"
    );
    if (request.method === "GET") {
      if (url.pathname === "/v1/oauth_applications") {
        return Response.json({
          data: application === undefined ? [] : [application],
          total_count: application === undefined ? 0 : 1,
        });
      }
      return Response.json(application);
    }
    const body = Schema.decodeUnknownSync(Input)(await request.json());
    writes.push(request.method);
    if (request.method === "POST") {
      application = {
        ...initial,
        ...body,
        redirect_uris: [...body.redirect_uris],
      };
      return Response.json({ ...application, client_secret: "oauth-secret" });
    }
    if (application === undefined) {
      throw new Error("Missing OAuth application");
    }
    application = {
      ...application,
      ...body,
      redirect_uris: [...body.redirect_uris],
    };
    return Response.json(application);
  };
  return {
    api: makeClerkOAuthApi(Redacted.make("clerk-api-secret"), fetchApi),
    discoveryAuthorization,
    failDiscovery: () => {
      rejectDiscovery = true;
    },
    foreignInstance: () => {
      if (application !== undefined) {
        application.instance_id = "admin-instance";
      }
    },
    writes,
  };
};
const TestLayer = clerkOAuthFileLayer.pipe(
  Layer.provideMerge(NodeServices.layer)
);
const run = <A, E, R>(body: (output: string) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "clerk-oauth-",
      });
      return yield* body(path.join(directory, "private.env"));
    })
  ).pipe(Effect.provide(TestLayer));

describe("Clerk OAuth provisioning", () => {
  it.effect(
    "creates a confidential OIDC client once, persists its secret privately and validates discovery without forwarding the API key",
    () =>
      run((output) =>
        Effect.gen(function* () {
          const target = fixture();
          const options = {
            api: target.api,
            dryRun: false,
            name: initial.name,
            output,
          };
          const created = yield* provisionClerkOAuth(options);
          expect(
            yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
              created
            )
          ).not.toContain("oauth-secret");
          const fs = yield* FileSystem.FileSystem;
          expect(yield* fs.readFileString(output)).toContain(
            'CLERK_OAUTH_CLIENT_SECRET="oauth-secret"'
          );
          expect({
            action: created.action,
            discoveryAuthorization: target.discoveryAuthorization,
            mode: (yield* fs.stat(output)).mode % 0o1000,
            nextAction: (yield* provisionClerkOAuth(options)).action,
            writes: target.writes,
          }).toEqual({
            action: "created",
            discoveryAuthorization: [null, null],
            mode: 0o600,
            nextAction: "unchanged",
            writes: ["POST"],
          });
        })
      )
  );
  it.effect(
    "adds the Shopify callback to the same client and preserves the saved secret and existing redirects",
    () =>
      run((output) =>
        Effect.gen(function* () {
          const target = fixture();
          const options = {
            api: target.api,
            dryRun: false,
            name: initial.name,
            output,
            redirectUri: "https://shopify.com/existing/callback",
          };
          yield* provisionClerkOAuth(options);
          const fs = yield* FileSystem.FileSystem;
          const saved = yield* fs.readFileString(output);
          const result = yield* provisionClerkOAuth({
            ...options,
            redirectUri: "https://shopify.com/new/callback",
          });
          expect(result.action).toBe("updated");
          expect(yield* fs.readFileString(output)).toBe(saved);
          const app = yield* target.api.get("oauth-1");
          expect(app.redirect_uris).toEqual([
            options.redirectUri,
            "https://shopify.com/new/callback",
          ]);
          expect(target.writes).toEqual(["POST", "PATCH"]);
        })
      )
  );
  it.effect("plans creation without writing a file or remote application", () =>
    run((output) =>
      Effect.gen(function* () {
        const target = fixture();
        const result = yield* provisionClerkOAuth({
          api: target.api,
          dryRun: true,
          name: initial.name,
          output,
        });
        expect(result.action).toBe("create");
        expect(target.writes).toEqual([]);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.exists(output)).toBeFalsy();
      })
    )
  );
  it.effect("refuses name-only adoption when a receipt is missing", () =>
    run((output) =>
      Effect.gen(function* () {
        const target = fixture(true);
        const error = yield* provisionClerkOAuth({
          api: target.api,
          dryRun: false,
          name: initial.name,
          output,
        }).pipe(Effect.flip);
        expect(error.message).toContain("never adopted by name");
        expect(target.writes).toEqual([]);
      })
    )
  );
  it.effect(
    "preserves the one-time secret if discovery fails and resumes without another create",
    () =>
      run((output) =>
        Effect.gen(function* () {
          const target = fixture();
          target.failDiscovery();
          const options = {
            api: target.api,
            dryRun: false,
            name: initial.name,
            output,
          };
          const error = yield* provisionClerkOAuth(options).pipe(Effect.flip);
          expect(
            yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
              error
            )
          ).not.toContain("oauth-secret");
          yield* provisionClerkOAuth(options);
          expect(target.writes).toEqual(["POST"]);
        })
      )
  );
  it.effect(
    "rejects a credential file from another Clerk instance before modifying the application",
    () =>
      run((output) =>
        Effect.gen(function* () {
          const target = fixture();
          const options = {
            api: target.api,
            dryRun: false,
            name: initial.name,
            output,
          };
          yield* provisionClerkOAuth(options);
          target.foreignInstance();
          const error = yield* provisionClerkOAuth({
            ...options,
            redirectUri: "https://shopify.com/new/callback",
          }).pipe(Effect.flip);
          expect(error.message).toContain("does not match this Clerk instance");
          expect(target.writes).toEqual(["POST"]);
        })
      )
  );
});
