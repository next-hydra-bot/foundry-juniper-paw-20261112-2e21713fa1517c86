"use server";

import { Actions } from "@repo/commerce-b2c/bindings";
import {
  CustomerProfileInput,
  CustomerAddressInput,
  CustomerAddressChangeInput,
} from "@repo/commerce-b2c/customer-account/schema";
import type { InputInvalid } from "@repo/errors";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Schema } from "effect";
import { revalidatePath } from "next/cache";

import {
  CustomerAccountActionError,
  customerAccountFailureMessageKey,
  projectCustomerAccountFailure,
} from "./action-contract";
import type { CustomerAccountActionResult } from "./action-contract";
import {
  updateCustomerProfile,
  addCustomerAddress,
  changeCustomerAddress,
} from "./procedures";

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

const profileAction = Actions.procedure("CustomerAccount.saveProfile")
  .input(Schema.fromFormData(CustomerProfileInput))
  .output(Schema.Null)
  .error(CustomerAccountActionError)
  .handle((input) =>
    projectCustomerAccountFailure(updateCustomerProfile(input))
  )
  .toFormAction({
    getFailureMessage,
    onSuccess: (_output, { locale }) => {
      revalidatePath(`/${locale}/account`);
      revalidatePath(`/${locale}/account/profile`);
    },
  });

const addressAction = Actions.procedure("CustomerAccount.saveAddress")
  .input(Schema.fromFormData(CustomerAddressInput))
  .output(Schema.Null)
  .error(CustomerAccountActionError)
  .handle((input, { locale }) =>
    projectCustomerAccountFailure(addCustomerAddress(input, locale))
  )
  .toFormAction({
    getFailureMessage,
    onSuccess: (_output, { locale }) => {
      revalidatePath(`/${locale}/account`);
      revalidatePath(`/${locale}/account/profile`);
    },
  });

const changeAddressAction = Actions.procedure("CustomerAccount.changeAddress")
  .input(Schema.fromFormData(CustomerAddressChangeInput))
  .output(Schema.Null)
  .error(CustomerAccountActionError)
  .handle((input, { locale }) =>
    projectCustomerAccountFailure(changeCustomerAddress(input, locale))
  )
  .toFormAction({
    getFailureMessage,
    onSuccess: (_output, { locale }) => {
      revalidatePath(`/${locale}/account/profile`);
    },
  });

export const saveCustomerProfileAction = async (
  previous: CustomerAccountActionResult | null,
  form: FormData
): Promise<CustomerAccountActionResult> => await profileAction(previous, form);
export const saveCustomerAddressAction = async (
  previous: CustomerAccountActionResult | null,
  form: FormData
): Promise<CustomerAccountActionResult> => await addressAction(previous, form);
export const changeCustomerAddressAction = async (
  previous: CustomerAccountActionResult | null,
  form: FormData
): Promise<CustomerAccountActionResult> =>
  await changeAddressAction(previous, form);
