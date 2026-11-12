import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { NextCookieStore } from "@repo/actions/next-request";
import type { WritableCustomerSessionManager } from "@shopify/hydrogen/customer-account";
import { Option, Schema } from "effect";

export const Customer = Schema.Struct({
  email: Schema.NonEmptyString,
  firstName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  lastName: Schema.NullOr(Schema.String),
});
const Envelope = Schema.Struct({
  expiresAt: Schema.Finite,
  customer: Schema.optional(Customer),
  cartSynchronizationPending: Schema.optional(Schema.Boolean),
  // The SDK owns its internal session shape. Validate JSON at this storage boundary.
  data: Schema.Record(Schema.String, Schema.Json),
});
const EnvelopeJson = Schema.fromJsonString(Envelope);
const CHUNK_SIZE = 3800;
const MAX_CHUNKS = 4;
export const CUSTOMER_COOKIE_NAME = "shopify-customer";
const MAX_AGE = 60 * 60 * 24 * 7;

interface CookieSessionManager extends WritableCustomerSessionManager {
  readonly getSessionItem: (name: string) => Schema.Json | undefined;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Hydrogen's SDK accepts unknown session values; the cookie adapter validates them with Schema.Json at this boundary.
  readonly setSessionItem: (name: string, value: unknown) => void;
  readonly removeSessionItem: (name: string) => void;
}

export interface CustomerSessionStorage {
  readonly manager: CookieSessionManager;
  readonly customer: () => typeof Customer.Type | undefined;
  readonly setCustomer: (customer: typeof Customer.Type) => void;
  readonly cartSynchronizationPending: () => boolean;
  readonly setCartSynchronizationPending: (pending: boolean) => void;
  readonly clear: () => void;
  readonly commit: () => void;
}

/** Authenticated encryption binds tokens to this shop, OAuth client and site session. */
export const openCustomerSession = ({
  cookies,
  secret,
  scope,
  origin,
  cookieName = CUSTOMER_COOKIE_NAME,
  maxAge = MAX_AGE,
  now = Date.now(),
}: {
  readonly cookies: NextCookieStore;
  readonly secret: string;
  readonly scope: string;
  readonly origin: string;
  readonly cookieName?: string;
  readonly maxAge?: number;
  readonly now?: number;
}): CustomerSessionStorage => {
  const key = createHash("sha256").update(secret).digest();
  let envelope: typeof Envelope.Type = {
    data: {},
    expiresAt: now + maxAge * 1000,
  };
  let encoded = "";
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    const part = cookies.get(`${cookieName}.${index}`)?.value;
    if (!part || part.length > CHUNK_SIZE) {
      break;
    }
    encoded += part;
  }
  if (encoded) {
    // Malformed, tampered, expired or differently scoped cookies are unauthenticated input.
    try {
      const bytes = Buffer.from(encoded, "base64url");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        bytes.subarray(0, 12)
      );
      decipher.setAAD(Buffer.from(scope));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]);
      const decoded = Schema.decodeOption(EnvelopeJson)(
        plaintext.toString("utf-8")
      );
      if (Option.isSome(decoded) && decoded.value.expiresAt > now) {
        envelope = decoded.value;
      }
    } catch {
      // Authentication failures deliberately disclose no cookie content or cryptographic detail.
    }
  }
  const data = new Map(Object.entries(envelope.data));
  let { customer } = envelope;
  let cartSynchronizationPending = envelope.cartSynchronizationPending ?? false;
  const manager: CookieSessionManager = {
    getSessionItem: (name) => data.get(name),
    getSessionOrigin: () => origin,
    removeSessionItem: (name) => {
      data.delete(name);
    },
    setSessionItem: (name, value) => {
      data.set(name, Schema.decodeUnknownSync(Schema.Json)(value));
    },
  };
  const clear = () => {
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      cookies.delete(`${cookieName}.${index}`);
    }
  };
  return {
    cartSynchronizationPending: () => cartSynchronizationPending,
    clear,
    commit: () => {
      const plaintext = Schema.encodeSync(EnvelopeJson)({
        ...envelope,
        cartSynchronizationPending,
        customer,
        data: Object.fromEntries(data),
      });
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(scope));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf-8"),
        cipher.final(),
      ]);
      const value = Buffer.concat([
        iv,
        cipher.getAuthTag(),
        ciphertext,
      ]).toString("base64url");
      if (value.length > MAX_CHUNKS * CHUNK_SIZE) {
        throw new Error(
          "Shopify customer session exceeds cookie storage capacity"
        );
      }
      const cookieMaxAge = Math.max(
        0,
        Math.floor((envelope.expiresAt - now) / 1000)
      );
      for (let index = 0; index < MAX_CHUNKS; index += 1) {
        const chunk = value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        if (chunk) {
          cookies.set(`${cookieName}.${index}`, chunk, {
            httpOnly: true,
            maxAge: cookieMaxAge,
            path: "/",
            sameSite: "lax",
            secure: true,
          });
        } else {
          cookies.delete(`${cookieName}.${index}`);
        }
      }
    },
    customer: () => customer,
    manager,
    setCartSynchronizationPending: (pending) => {
      cartSynchronizationPending = pending;
    },
    setCustomer: (value: typeof Customer.Type) => {
      customer = value;
    },
  };
};
