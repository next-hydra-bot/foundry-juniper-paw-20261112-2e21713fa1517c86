import type { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import type { CommerceCustomerProfile } from "@repo/commerce-core/domain/commerce-account";
import { CustomerAreaContent } from "@repo/design-system/components/layout/customer-area";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { getTranslations } from "@repo/i18n";
import type { Locale } from "@repo/i18n/types";
import { Redacted } from "effect";

import type { CustomerAccountAction } from "./action-contract";
import {
  CustomerAddressDialog,
  CustomerProfileForm,
  SavedAddressCard,
} from "./forms";

export const CustomerAccountView = async ({
  locale,
  profile,
  addresses,
  addressReference,
  saveProfile,
  saveAddress,
  changeAddress,
}: {
  readonly locale: Locale;
  readonly profile: CommerceCustomerProfile;
  readonly addresses: readonly AddressBookEntry[];
  readonly addressReference: string;
  readonly saveProfile: CustomerAccountAction;
  readonly saveAddress: CustomerAccountAction;
  readonly changeAddress: CustomerAccountAction;
}) => {
  const t = await getTranslations({ locale, namespace: "web.customerAccount" });
  return (
    <CustomerAreaContent
      description={t("description")}
      title={t("customerDetails")}
    >
      <div className="grid gap-6">
        <CustomerProfileForm
          action={saveProfile}
          profile={{
            email:
              profile.email === undefined ? "" : Redacted.value(profile.email),
            firstName:
              profile.firstName === undefined
                ? ""
                : Redacted.value(profile.firstName),
            lastName:
              profile.lastName === undefined
                ? ""
                : Redacted.value(profile.lastName),
          }}
        />
        <section className="grid gap-6" id="addresses">
          <Card>
            <CardHeader className="items-center">
              <CardTitle>{t("addressesTitle")}</CardTitle>
              <CardAction>
                <CustomerAddressDialog
                  action={saveAddress}
                  reference={addressReference}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {addresses.length === 0 ? (
                <p className="text-muted-foreground">{t("noAddresses")}</p>
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {addresses.map(
                    ({
                      address,
                      defaultBilling,
                      defaultShipping,
                      reference,
                    }) => (
                      <li key={reference}>
                        <SavedAddressCard
                          action={changeAddress}
                          entry={{
                            address,
                            defaultBilling,
                            defaultShipping,
                            reference,
                          }}
                        />
                      </li>
                    )
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </CustomerAreaContent>
  );
};
