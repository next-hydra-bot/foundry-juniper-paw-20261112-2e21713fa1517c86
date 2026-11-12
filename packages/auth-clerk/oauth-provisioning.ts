import { PrivateDotEnvFile } from "@repo/cli-core/private-dotenv";
import {
  Config,
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Path,
  Redacted,
  Schema,
} from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class ClerkOAuthProvisioningError extends Schema.TaggedError<ClerkOAuthProvisioningError>()(
  "ClerkOAuthProvisioningError",
  { message: Schema.String }
) {}
const fail = (message: string) => new ClerkOAuthProvisioningError({ message });
const scopes = ["openid", "email", "profile"];
const Application = Schema.Struct({
  client_id: Schema.NonEmptyString,
  client_secret: Schema.optionalKey(
    Schema.RedactedFromValue(Schema.NonEmptyString)
  ),
  consent_screen_enabled: Schema.Boolean,
  discovery_url: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  instance_id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  pkce_required: Schema.Boolean,
  public: Schema.Boolean,
  redirect_uris: Schema.Array(Schema.String),
  scopes: Schema.String,
});
type Application = typeof Application.Type;
export interface ClerkOAuthCredentials {
  readonly applicationId: string;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted;
  readonly discoveryUrl: string;
  readonly instanceId: string;
}
export const httpsOAuthUrl = (value: string) =>
  Effect.try({
    catch: () =>
      fail(
        "OAuth URLs must be absolute HTTPS URLs without credentials or fragments."
      ),
    try: () => {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash
      ) {
        throw new Error("Invalid OAuth URL");
      }
      return url.href;
    },
  });

/** Effect transport is used because the SDK does not expose the consent and PKCE provisioning fields. */
export const makeClerkOAuthApi = (
  secret: Redacted.Redacted,
  fetchApi: typeof fetch = globalThis.fetch
) => {
  const client = HttpClient.HttpClient.pipe(
    Effect.provide(
      Layer.fresh(FetchHttpClient.layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(FetchHttpClient.Fetch, fetchApi),
            Layer.succeed(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            })
          )
        )
      )
    )
  );
  const request = Effect.fn("ClerkOAuth.request")(function* (
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: Readonly<Record<string, Schema.Json>>
  ) {
    const http = yield* client;
    let httpRequest = HttpClientRequest.make(method)(
      `https://api.clerk.com/v1${path}`
    ).pipe(HttpClientRequest.bearerToken(secret));
    if (body !== undefined) {
      httpRequest = yield* HttpClientRequest.bodyJson(httpRequest, body);
    }
    const response = yield* http.execute(httpRequest);
    if (response.status < 200 || response.status >= 300) {
      return yield* fail(
        `Clerk OAuth ${method} failed (HTTP ${response.status}). Check API access and existing applications before retrying.`
      );
    }
    return yield* response.json;
  });
  const run = <A, E>(operation: Effect.Effect<A, E>) =>
    operation.pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError((error) =>
        Schema.is(ClerkOAuthProvisioningError)(error)
          ? error
          : fail(
              "Clerk OAuth request could not be confirmed. Inspect existing applications before retrying; credentials are not included in this error."
            )
      )
    );
  return {
    create: (name: string, redirects: readonly string[]) =>
      run(
        request("POST", "/oauth_applications", {
          consent_screen_enabled: false,
          name,
          pkce_required: false,
          public: false,
          redirect_uris: [...redirects],
          scopes: scopes.join(" "),
        }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Application)))
      ),
    get: (id: string) =>
      run(
        request("GET", `/oauth_applications/${encodeURIComponent(id)}`).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Application))
        )
      ),
    list: (offset: number) =>
      run(
        request("GET", `/oauth_applications?limit=100&offset=${offset}`).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.Struct({
                data: Schema.Array(Application),
                total_count: Schema.Int,
              })
            )
          )
        )
      ),
    update: (application: Application, redirects: readonly string[]) =>
      run(
        request(
          "PATCH",
          `/oauth_applications/${encodeURIComponent(application.id)}`,
          {
            consent_screen_enabled: false,
            name: application.name,
            pkce_required: false,
            public: false,
            redirect_uris: [...redirects],
            scopes: [
              ...new Set([
                ...application.scopes.split(/\s+/u).filter(Boolean),
                ...scopes,
              ]),
            ].join(" "),
          }
        ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Application)))
      ),
    validateDiscovery: (url: string) =>
      run(
        Effect.gen(function* () {
          const address = yield* httpsOAuthUrl(url);
          const http = HttpClient.filterStatusOk(yield* client);
          // This request intentionally has no Clerk API authorization header.
          const response = yield* http.get(address);
          const data = yield* response.json;
          const document = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              authorization_endpoint: Schema.String,
              issuer: Schema.String,
              jwks_uri: Schema.String,
              token_endpoint: Schema.String,
            })
          )(data);
          for (const value of Object.values(document)) {
            yield* httpsOAuthUrl(value);
          }
          return document;
        })
      ),
  };
};

const readCredentials = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(file);
    if (info.type !== "File" || info.mode % 0o1000 !== 0o600) {
      return yield* fail(
        "The OAuth credential file must be a private regular file with mode 0600."
      );
    }
    const provider = yield* ConfigProvider.fromDotEnv({ path: file });
    return yield* Config.all({
      applicationId: Config.schema(
        Schema.NonEmptyString,
        "CLERK_OAUTH_APPLICATION_ID"
      ),
      clientId: Config.schema(Schema.NonEmptyString, "CLERK_OAUTH_CLIENT_ID"),
      clientSecret: Config.Redacted("CLERK_OAUTH_CLIENT_SECRET"),
      discoveryUrl: Config.schema(
        Schema.NonEmptyString,
        "CLERK_OAUTH_DISCOVERY_URL"
      ),
      instanceId: Config.schema(
        Schema.NonEmptyString,
        "CLERK_OAUTH_INSTANCE_ID"
      ),
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider));
  }).pipe(
    Effect.mapError((error) =>
      Schema.is(ClerkOAuthProvisioningError)(error)
        ? error
        : fail(
            "The OAuth credential file is invalid; its contents are not included in this error."
          )
    )
  );

export const provisionClerkOAuth = Effect.fn("ClerkOAuth.provision")(
  function* (options: {
    readonly api: ReturnType<typeof makeClerkOAuthApi>;
    readonly dryRun: boolean;
    readonly name: string;
    readonly output: string;
    readonly redirectUri?: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const output = path.resolve(options.output);
    const redirect =
      options.redirectUri === undefined
        ? undefined
        : yield* httpsOAuthUrl(options.redirectUri);
    let application: Application;
    let credentials: ClerkOAuthCredentials;
    let action: "created" | "updated" | "unchanged" = "unchanged";
    const exists = yield* fs
      .exists(output)
      .pipe(
        Effect.mapError(() =>
          fail(
            `Cannot inspect the OAuth credential file: ${output}. Check the --output path and its permissions. No Clerk API request was sent.`
          )
        )
      );
    if (exists) {
      credentials = yield* readCredentials(output);
      application = yield* options.api.get(credentials.applicationId);
      if (
        application.id !== credentials.applicationId ||
        application.instance_id !== credentials.instanceId ||
        application.client_id !== credentials.clientId ||
        application.discovery_url !== credentials.discoveryUrl ||
        application.public
      ) {
        return yield* fail(
          "The OAuth credential file does not match this Clerk instance and confidential application."
        );
      }
    } else {
      const directory = path.dirname(output);
      yield* fs
        .access(directory, { writable: true })
        .pipe(
          Effect.mapError(() =>
            fail(
              `The OAuth output directory is missing or not writable: ${directory}. Create it or choose a writable --output path. No Clerk API request was sent.`
            )
          )
        );
      for (let offset = 0; ;) {
        const page = yield* options.api.list(offset);
        if (page.data.some((item) => item.name === options.name)) {
          return yield* fail(
            "An OAuth application with this name already exists. Reuse its private credential file or choose a different name; existing clients are never adopted by name or rotated automatically."
          );
        }
        offset += page.data.length;
        if (offset >= page.total_count) {
          break;
        }
        if (page.data.length === 0) {
          return yield* fail(
            "Clerk returned incomplete OAuth application pagination."
          );
        }
      }
      if (options.dryRun) {
        return { action: "create" as const, output, redirectUri: redirect };
      }
      application = yield* options.api.create(
        options.name,
        redirect === undefined ? [] : [redirect]
      );
      if (application.client_secret === undefined || application.public) {
        return yield* fail(
          "Clerk did not return a confidential client secret. Inspect the created application before retrying."
        );
      }
      credentials = {
        applicationId: application.id,
        clientId: application.client_id,
        clientSecret: application.client_secret,
        discoveryUrl: application.discovery_url,
        instanceId: application.instance_id,
      };
      // Persist the one-time secret before subsequent validation or callback operations.
      const privateFile = yield* PrivateDotEnvFile;
      yield* privateFile
        .publish(
          {
            CLERK_OAUTH_APPLICATION_ID: credentials.applicationId,
            CLERK_OAUTH_CLIENT_ID: credentials.clientId,
            CLERK_OAUTH_CLIENT_SECRET: Redacted.value(credentials.clientSecret),
            CLERK_OAUTH_DISCOVERY_URL: credentials.discoveryUrl,
            CLERK_OAUTH_INSTANCE_ID: credentials.instanceId,
          },
          output
        )
        .pipe(
          Effect.mapError(() =>
            fail(
              "The OAuth application was created but its credential file could not be saved. Inspect Clerk before retrying; do not create another client or rotate its secret blindly."
            )
          )
        );
      action = "created";
    }
    const redirects = [
      ...new Set([
        ...application.redirect_uris,
        ...(redirect === undefined ? [] : [redirect]),
      ]),
    ];
    const needsUpdate =
      redirects.length !== application.redirect_uris.length ||
      application.consent_screen_enabled ||
      application.pkce_required ||
      !scopes.every((scope) =>
        application.scopes.split(/\s+/u).includes(scope)
      );
    if (needsUpdate) {
      if (options.dryRun) {
        return { action: "update" as const, output, redirectUri: redirect };
      }
      const updated = yield* options.api.update(application, redirects);
      if (
        updated.id !== application.id ||
        updated.instance_id !== application.instance_id ||
        updated.client_id !== application.client_id
      ) {
        return yield* fail(
          "Clerk returned a different OAuth application during update."
        );
      }
      application = updated;
      if (action !== "created") {
        action = "updated";
      }
    }
    if (
      application.public ||
      application.consent_screen_enabled ||
      application.pkce_required ||
      !scopes.every((scope) =>
        application.scopes.split(/\s+/u).includes(scope)
      ) ||
      !redirects.every((uri) => application.redirect_uris.includes(uri))
    ) {
      return yield* fail(
        "Clerk did not confirm the requested OAuth scopes, callback or first-party client settings."
      );
    }
    yield* options.api.validateDiscovery(credentials.discoveryUrl);
    // Receipts exclude the client secret; it remains in the private file.
    return {
      action,
      applicationId: application.id,
      clientId: application.client_id,
      discoveryUrl: application.discovery_url,
      output,
      redirectUri: redirect,
    };
  }
);

export { privateDotEnvFileLayer as clerkOAuthFileLayer } from "@repo/cli-core/private-dotenv";
