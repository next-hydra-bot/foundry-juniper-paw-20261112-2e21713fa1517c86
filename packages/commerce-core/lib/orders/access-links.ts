import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";

import { EmailOrderAccess } from "../../domain/order-access";
import { OrderQueryFailure } from "../../domain/order-history";
import { OrderAccessLinks } from "../../services/order-access-links";

const payload = Schema.fromJsonString(Schema.toCodecJson(EmailOrderAccess));
const aad = Buffer.from("commerce-email-order-access:v1");
const configurationFailure = () =>
  new OrderQueryFailure({
    message:
      "Email order links require a storefront origin and a 32-byte base64url COMMERCE_ORDER_ACCESS_SECRET.",
    operation: "findById",
    reason: "configuration",
  });
class InvalidOrderAccess extends Schema.TaggedError<InvalidOrderAccess>()(
  "InvalidOrderAccess",
  {}
) {}

const makeOrderAccessLinks = (configuration: {
  readonly secret: Redacted.Redacted;
  readonly origin: string;
}) => {
  const configured = Effect.try({
    catch: configurationFailure,
    try: () => {
      const secret = Redacted.value(configuration.secret);
      const key = Buffer.from(secret, "base64url");
      const origin = new URL(configuration.origin);
      if (
        !/^[\w-]{43}$/u.test(secret) ||
        key.length !== 32 ||
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      ) {
        throw new Error("Invalid order link configuration");
      }
      return { key, origin };
    },
  });
  return OrderAccessLinks.of({
    issue: (access, locale) =>
      Effect.gen(function* () {
        const { key, origin } = yield* configured;
        const value = yield* Schema.encodeEffect(payload)(access).pipe(
          Effect.mapError(configurationFailure)
        );
        return yield* Effect.try({
          catch: configurationFailure,
          try: () => {
            const iv = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", key, iv);
            cipher.setAAD(aad);
            const encrypted = Buffer.concat([
              cipher.update(value, "utf-8"),
              cipher.final(),
            ]);
            const token = Buffer.concat([
              iv,
              cipher.getAuthTag(),
              encrypted,
            ]).toString("base64url");
            const url = new URL(
              `/${locale}/orders/${encodeURIComponent(access.orderId)}/access`,
              origin
            );
            url.searchParams.set("token", `v1.${token}`);
            return Redacted.make(url.toString(), { label: "orderAccessUrl" });
          },
        });
      }),
    verify: (token) =>
      Effect.gen(function* () {
        const { key } = yield* configured;
        const decoded = yield* Effect.try({
          catch: () => new InvalidOrderAccess({}),
          try: () => {
            const raw = Redacted.value(token);
            if (raw.length > 4096 || !/^v1\.[\w-]+$/u.test(raw)) {
              throw new Error("Invalid order link");
            }
            const bytes = Buffer.from(raw.slice(3), "base64url");
            if (bytes.length < 29) {
              throw new Error("Invalid order link");
            }
            const decipher = createDecipheriv(
              "aes-256-gcm",
              key,
              bytes.subarray(0, 12)
            );
            decipher.setAAD(aad);
            decipher.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([
              decipher.update(bytes.subarray(28)),
              decipher.final(),
            ]).toString("utf-8");
          },
        }).pipe(
          Effect.flatMap((value) => Schema.decodeEffect(payload)(value)),
          Effect.map(Option.some),
          Effect.catch(() => Effect.succeed(Option.none<EmailOrderAccess>()))
        );
        return decoded;
      }),
  });
};

export const orderAccessLinksLayerWith = (
  configuration: Parameters<typeof makeOrderAccessLinks>[0]
) => Layer.succeed(OrderAccessLinks, makeOrderAccessLinks(configuration));

const environment = Config.schema(
  Schema.Struct({
    COMMERCE_ORDER_ACCESS_SECRET: Schema.Redacted(Schema.NonEmptyString),
    NEXT_PUBLIC_WEB_URL: Schema.NonEmptyString,
  })
).pipe(Effect.mapError(configurationFailure));

/** Configuration is read only when issuing or verifying a link; company emails need no guest secret. */
export const orderAccessLinksLayer = Layer.succeed(OrderAccessLinks, {
  issue: (access, locale) =>
    environment.pipe(
      Effect.flatMap((values) =>
        makeOrderAccessLinks({
          origin: values.NEXT_PUBLIC_WEB_URL,
          secret: values.COMMERCE_ORDER_ACCESS_SECRET,
        }).issue(access, locale)
      )
    ),
  verify: (token) =>
    environment.pipe(
      Effect.flatMap((values) =>
        makeOrderAccessLinks({
          origin: values.NEXT_PUBLIC_WEB_URL,
          secret: values.COMMERCE_ORDER_ACCESS_SECRET,
        }).verify(token)
      )
    ),
});
