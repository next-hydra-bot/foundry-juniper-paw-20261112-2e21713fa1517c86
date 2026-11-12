import { scopedRoleSessionClaims } from "@repo/auth-contract/session-claims-provisioning";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { makeClerkSessionClaimsProvisioner } from "./session-claims-provisioning";
import type { ClerkClaimsCommand } from "./session-claims-provisioning";

const Patch = Schema.Struct({
  session: Schema.Struct({ claims: Schema.Record(Schema.String, Schema.Json) }),
});
const fixture = (
  initial: Readonly<Record<string, Schema.Json>> | null,
  options: {
    readonly accessible?: boolean;
    readonly ignoreWrite?: boolean;
    readonly supported?: boolean;
  } = {}
) => {
  let claims = initial;
  const calls: {
    readonly args: readonly string[];
    readonly input?: Readonly<Record<string, Schema.Json>>;
  }[] = [];
  const command: ClerkClaimsCommand = {
    run: (args, input) =>
      Effect.sync(() => {
        calls.push({ args, input });
        if (args[0] === "apps") {
          return JSON.stringify([
            {
              application_id: "app-admin",
              instances: [{ instance_id: "ins-admin" }],
            },
            {
              application_id: "app-shopper",
              instances: [
                {
                  instance_id:
                    options.accessible === false ? "ins-other" : "ins-shopper",
                },
              ],
            },
          ]);
        }
        if (args[1] === "schema") {
          return JSON.stringify({
            properties: {
              session: {
                properties: {
                  claims: {
                    type: options.supported === false ? "string" : "object",
                  },
                },
              },
            },
          });
        }
        if (args[1] === "pull") {
          return JSON.stringify({
            session:
              claims === null
                ? null
                : { allowed_clock_skew: 10, claims, lifetime: 120 },
          });
        }
        if (
          args[1] === "patch" &&
          !args.includes("--dry-run") &&
          !options.ignoreWrite
        ) {
          const patch = Schema.decodeUnknownSync(Patch)(input);
          const next = new Map(Object.entries(claims ?? {}));
          for (const [key, value] of Object.entries(patch.session.claims)) {
            if (value === null) {
              next.delete(key);
            } else {
              next.set(key, value);
            }
          }
          claims = Object.fromEntries(next);
        }
        return "{}";
      }),
  };
  return {
    calls,
    claims: () => claims,
    provisioner: makeClerkSessionClaimsProvisioner({
      command,
      instanceId: Effect.succeed("ins-shopper"),
    }),
  };
};

describe("Clerk session claim provisioning", () => {
  it("patches only owned claims on the instance selected by the customer key", async () => {
    const current = {
      app_permissions: "{{user.public_metadata.application_permissions}}",
      extra: { enabled: true, options: ["a", "b"] },
      locale: "{{user.public_metadata.locale}}",
      nullable: null,
    };
    const state = fixture(current);
    const result = await Effect.runPromise(
      state.provisioner.provision({
        definitions: scopedRoleSessionClaims,
        dryRun: false,
      })
    );
    expect(result).toMatchObject({
      action: "updated",
      claims: ["app_roles"],
      removed: ["app_permissions"],
    });
    expect(state.claims()).toEqual({
      app_roles: "{{user.public_metadata.application_roles}}",
      extra: current.extra,
      locale: current.locale,
      nullable: null,
    });
    const patch = state.calls.find((call) => call.args[1] === "patch");
    expect(patch).toEqual({
      args: [
        "config",
        "patch",
        "--app",
        "app-shopper",
        "--instance",
        "ins-shopper",
        "--yes",
      ],
      input: {
        session: {
          claims: {
            app_permissions: null,
            app_roles: "{{user.public_metadata.application_roles}}",
          },
        },
      },
    });
  });

  it("creates claims from a null session template and skips an identical rerun", async () => {
    const state = fixture(null);
    await expect(
      Effect.runPromise(
        state.provisioner.provision({
          definitions: scopedRoleSessionClaims,
          dryRun: false,
        })
      )
    ).resolves.toMatchObject({ action: "updated" });
    await expect(
      Effect.runPromise(
        state.provisioner.provision({
          definitions: scopedRoleSessionClaims,
          dryRun: false,
        })
      )
    ).resolves.toMatchObject({ action: "unchanged" });
    expect(state.calls.filter((call) => call.args[1] === "patch")).toHaveLength(
      1
    );
  });

  it("validates the proposed patch through Clerk's dry run and leaves claims intact", async () => {
    const state = fixture({ app_permissions: "previous", locale: "en" });
    await expect(
      Effect.runPromise(
        state.provisioner.provision({
          definitions: scopedRoleSessionClaims,
          dryRun: true,
        })
      )
    ).resolves.toMatchObject({ action: "planned" });
    expect(
      state.calls.find((call) => call.args[1] === "patch")?.args
    ).toContain("--dry-run");
    expect(state.claims()).toEqual({
      app_permissions: "previous",
      locale: "en",
    });
  });

  it.each([{ accessible: false }, { supported: false }])(
    "refuses unsupported targets before writing: %j",
    async (options) => {
      const state = fixture({}, options);
      await expect(
        Effect.runPromise(
          state.provisioner.provision({
            definitions: scopedRoleSessionClaims,
            dryRun: false,
          })
        )
      ).rejects.toThrow(/Clerk/u);
      expect(
        state.calls.filter((call) => call.args[1] === "patch")
      ).toHaveLength(0);
    }
  );

  it("does not report success when the provider fails to retain the patch", async () => {
    const state = fixture({}, { ignoreWrite: true });
    await expect(
      Effect.runPromise(
        state.provisioner.provision({
          definitions: scopedRoleSessionClaims,
          dryRun: false,
        })
      )
    ).rejects.toThrow("did not retain");
  });
});
