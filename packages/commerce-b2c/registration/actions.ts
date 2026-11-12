"use server";

import { Actions } from "@repo/commerce-b2c/bindings";
import type { InputInvalid } from "@repo/errors";
import { getTranslations } from "@repo/i18n";
import { redirect } from "@repo/i18n/navigation";
import type { Locale } from "@repo/i18n/types";
import { Schema } from "effect";
import { revalidatePath } from "next/cache";

import {
  CustomerAccountActionError,
  customerAccountFailureMessageKey,
  projectCustomerAccountFailure,
} from "../customer-account/action-contract";
import type { CustomerAccountActionResult } from "../customer-account/action-contract";
import { registerCustomer } from "./procedures";
import { CustomerRegistrationInput } from "./schema";

const getFailureMessage = async (
  error: CustomerAccountActionError | InputInvalid,
  { locale }: { readonly locale: Locale }
) => {
  const t = await getTranslations({
    locale,
    namespace: "web.customerAccount.errors",
  });
  return t(customerAccountFailureMessageKey(error));
};

const registerAction = Actions.procedure("CustomerAccount.register")
  .input(Schema.fromFormData(CustomerRegistrationInput))
  .output(Schema.Null)
  .error(CustomerAccountActionError)
  .handle((input, { locale }) =>
    projectCustomerAccountFailure(registerCustomer(input, locale))
  )
  .toFormAction({
    getFailureMessage,
    onSuccess: (_output, { locale }) => {
      revalidatePath(`/${locale}/account`);
      redirect({ href: "/account", locale });
    },
  });

export const submitCustomerRegistration = async (
  previous: CustomerAccountActionResult | null,
  form: FormData
): Promise<CustomerAccountActionResult> => await registerAction(previous, form);
