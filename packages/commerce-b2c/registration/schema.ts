import { Schema } from "effect";

import {
  CustomerProfileInput,
  CustomerAddressInput,
  requireAddressRegion,
} from "../customer-account/schema";

export const CustomerRegistrationInput = Schema.Struct({
  ...CustomerProfileInput.fields,
  ...CustomerAddressInput.fields,
}).check(requireAddressRegion);
export type CustomerRegistrationInput = typeof CustomerRegistrationInput.Type;
