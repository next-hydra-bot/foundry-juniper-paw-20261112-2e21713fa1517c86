import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { createClerkClient } from "@clerk/nextjs/server";
import { AuthUser } from "@repo/auth-contract/session";
import { AuthUsers, AuthUserLookupFailure } from "@repo/auth-contract/users";
import { hasTransientTransportCode } from "@repo/errors/transport";
import { Config, Effect, Layer, Schema } from "effect";

const User = Schema.Struct({
  emailAddresses: Schema.Array(
    Schema.Struct({
      emailAddress: Schema.NonEmptyString,
      id: Schema.NonEmptyString,
      verification: Schema.NullOr(Schema.Struct({ status: Schema.String })),
    })
  ),
  firstName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  imageUrl: Schema.String,
  lastName: Schema.NullOr(Schema.String),
  primaryEmailAddressId: Schema.NullOr(Schema.String),
});

export type ClerkAuthUser = typeof User.Type;

export const authUsersLayerWith = (
  getUser: (id: string) => Promise<ClerkAuthUser>
) =>
  Layer.succeed(AuthUsers, {
    getById: (id) =>
      Effect.tryPromise({
        catch: (cause) => {
          if (isClerkAPIResponseError(cause) && cause.status === 404) {
            return new AuthUserLookupFailure({ reason: "notFound" });
          }
          if (
            hasTransientTransportCode(cause) ||
            (isClerkAPIResponseError(cause) &&
              (cause.status === 429 || cause.status >= 500))
          ) {
            return new AuthUserLookupFailure({ reason: "unavailable" });
          }
          return new AuthUserLookupFailure({ reason: "unexpectedResponse" });
        },
        try: async () => await getUser(id),
      }).pipe(
        Effect.flatMap((value) =>
          Schema.decodeEffect(User)(value).pipe(
            Effect.mapError(
              () => new AuthUserLookupFailure({ reason: "unexpectedResponse" })
            ),
            Effect.flatMap((user) => {
              if (user.id !== id) {
                return Effect.fail(
                  new AuthUserLookupFailure({ reason: "unexpectedResponse" })
                );
              }
              const email = user.emailAddresses.find(
                (entry) => entry.id === user.primaryEmailAddressId
              );
              return Effect.succeed({
                emailVerified: email?.verification?.status === "verified",
                user: new AuthUser({
                  email: email?.emailAddress ?? null,
                  firstName: user.firstName,
                  id: user.id,
                  lastName: user.lastName,
                  profilePictureUrl: user.imageUrl,
                }),
              });
            })
          )
        )
      ),
  });

export const authUsersLayer = Layer.unwrap(
  Effect.gen(function* () {
    const secretKey = yield* Config.String("CLERK_SECRET_KEY");
    const client = createClerkClient({ secretKey });
    return authUsersLayerWith(async (id) => await client.users.getUser(id));
  })
);
