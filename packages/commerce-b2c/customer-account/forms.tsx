"use client";

import type { AddressBookEntry } from "@repo/commerce-core/domain/address-book";
import {
  addressRegionCode,
  addressRegions,
} from "@repo/commerce-core/domain/address-regions";
import {
  Alert,
  AlertDescription,
} from "@repo/design-system/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/design-system/components/ui/alert-dialog";
import { Badge } from "@repo/design-system/components/ui/badge";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/design-system/components/ui/dialog";
import { Input } from "@repo/design-system/components/ui/input";
import { Label } from "@repo/design-system/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { useLocale, useTranslations } from "@repo/i18n";
import { ISO_COUNTRY_CODES } from "@repo/i18n/countries";
import { useActionState, useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  CustomerAccountAction,
  CustomerAccountActionResult,
} from "./action-contract";

export interface CustomerProfileValues {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export const ProfileFields = ({
  email,
  firstName,
  lastName,
}: CustomerProfileValues) => {
  const t = useTranslations("web.registration.form.fields");
  const id = useId();
  const [names, setNames] = useState({ firstName, lastName });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-first`}>{t("firstName.label")}</Label>
        <Input
          autoComplete="given-name"
          value={names.firstName}
          onChange={(event) => {
            setNames({ ...names, firstName: event.target.value });
          }}
          id={`${id}-first`}
          maxLength={80}
          name="firstName"
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-last`}>{t("lastName.label")}</Label>
        <Input
          autoComplete="family-name"
          value={names.lastName}
          onChange={(event) => {
            setNames({ ...names, lastName: event.target.value });
          }}
          id={`${id}-last`}
          maxLength={80}
          name="lastName"
          required
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor={`${id}-email`}>{t("email.label")}</Label>
        <Input
          autoComplete="email"
          id={`${id}-email`}
          readOnly
          type="email"
          value={email}
        />
      </div>
    </div>
  );
};

export const AddressFields = ({
  address,
  reference,
}: {
  readonly address?: AddressBookEntry["address"];
  readonly reference: string;
}) => {
  const t = useTranslations("web.registration.form.fields");
  const locale = useLocale();
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const defaultCountry = locale.split("-")[1] ?? "US";
  const [country, setCountry] = useState(
    address ? (address.country ?? "") : defaultCountry
  );
  const [region, setRegion] = useState(
    addressRegionCode(address?.country ?? "", address?.region) ?? ""
  );
  const [values, setValues] = useState({
    addressLine1: address?.addressLine1 ?? "",
    addressLine2: address?.addressLine2 ?? "",
    city: address?.city ?? "",
    postalCode: address?.postalCode ?? "",
  });
  const regions = addressRegions(country);
  const selectedRegion = regions.some(({ code }) => code === region)
    ? region
    : "";
  const id = useId();
  const fields = [
    {
      autoComplete: "address-line1",
      label: t("streetAddress.label"),
      maxLength: 120,
      name: "addressLine1",
      required: true,
    },
    {
      autoComplete: "address-line2",
      label: t("addressLine2.label"),
      maxLength: 120,
      name: "addressLine2",
      required: false,
    },
    {
      autoComplete: "postal-code",
      label: t("postalCode.label"),
      maxLength: 32,
      name: "postalCode",
      required: true,
    },
    {
      autoComplete: "address-level2",
      label: t("city.label"),
      maxLength: 80,
      name: "city",
      required: true,
    },
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <input name="reference" type="hidden" value={reference} />
      {/* Native Select controls reset after form Actions; submit the controlled values. */}
      <input name="country" type="hidden" value={country} />
      {fields.map((field) => (
        <div
          className={
            field.name === "addressLine1" || field.name === "addressLine2"
              ? "grid gap-2 sm:col-span-2"
              : "grid gap-2"
          }
          key={field.name}
        >
          <Label htmlFor={`${id}-${field.name}`}>{field.label}</Label>
          <Input
            autoComplete={field.autoComplete}
            id={`${id}-${field.name}`}
            maxLength={field.maxLength}
            name={field.name}
            required={field.required}
            value={values[field.name]}
            onChange={(event) => {
              setValues({ ...values, [field.name]: event.target.value });
            }}
          />
        </div>
      ))}
      <div className="grid gap-2">
        <Label htmlFor={`${id}-region`}>
          {t(regions.length > 0 ? "region.requiredLabel" : "region.codeLabel")}
        </Label>
        {regions.length > 0 ? (
          <>
            <input name="region" type="hidden" value={selectedRegion} />
            <Select value={selectedRegion} onValueChange={setRegion} required>
              <SelectTrigger className="w-full" id={`${id}-region`}>
                <SelectValue placeholder={t("region.selectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {regions.map(({ code, label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <Input
            id={`${id}-region`}
            name="region"
            maxLength={80}
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
            }}
          />
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-country`}>{t("country.label")}</Label>
        <Select
          onValueChange={(country) => {
            setCountry(country);
            setRegion("");
          }}
          value={country}
          required
        >
          <SelectTrigger className="w-full" id={`${id}-country`}>
            <SelectValue placeholder={t("country.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {ISO_COUNTRY_CODES.map((code) => ({
              code,
              label: displayNames.of(code) ?? code,
            }))
              // oxlint-disable-next-line unicorn/no-array-sort -- This newly allocated list targets ES2022, which has no toSorted API.
              .sort((left, right) => left.label.localeCompare(right.label))
              .map(({ code, label }) => (
                <SelectItem key={code} value={code}>
                  {label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export const AccountForm = ({
  action,
  children,
  title,
  submitLabel,
}: {
  readonly action: CustomerAccountAction;
  readonly children: ReactNode;
  readonly title: string;
  readonly submitLabel: string;
}) => {
  const [result, formAction, pending] = useActionState<
    CustomerAccountActionResult | null,
    FormData
  >(action, null);
  const t = useTranslations("web.customerAccount");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-6">
          {result?._tag === "Failure" ? (
            <Alert role="alert" variant="destructive">
              <AlertDescription>
                {result.failure.displayMessage}
              </AlertDescription>
            </Alert>
          ) : null}
          {result?._tag === "Success" ? (
            <p role="status">{t("saved")}</p>
          ) : null}
          {children}
          <Button
            className="justify-self-start"
            disabled={pending}
            type="submit"
          >
            {pending ? t("saving") : submitLabel}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export const CustomerProfileForm = ({
  action,
  profile,
}: {
  readonly action: CustomerAccountAction;
  readonly profile: CustomerProfileValues;
}) => {
  const t = useTranslations("web.customerAccount");
  return (
    <AccountForm
      action={action}
      submitLabel={t("saveProfile")}
      title={t("profileTitle")}
    >
      <ProfileFields {...profile} />
    </AccountForm>
  );
};

type SavedAddressDetails = Pick<
  AddressBookEntry,
  "address" | "reference" | "defaultShipping" | "defaultBilling"
>;

const AddressChangeForm = ({
  action,
  address,
  operation,
  reference,
  onSaved,
}: {
  readonly action: CustomerAccountAction;
  readonly address?: SavedAddressDetails["address"];
  readonly operation: "add" | "edit" | "remove" | "setDefault";
  readonly reference: string;
  readonly onSaved?: () => void;
}) => {
  const t = useTranslations("web.customerAccount");
  const [result, submit, pending] = useActionState<
    CustomerAccountActionResult | null,
    FormData
  >(async (previous, form) => {
    const outcome = await action(previous, form);
    if (outcome._tag === "Success") {
      onSaved?.();
    }
    return outcome;
  }, null);
  const failure = result?._tag === "Failure" ? result.failure : undefined;
  const needsRefresh = failure?.error.recovery === "refresh";
  const isEditor = operation === "add" || operation === "edit";
  const { label, variant } = (
    {
      add: { label: t("saveAddress"), variant: "default" },
      edit: { label: t("saveAddress"), variant: "default" },
      remove: { label: t("removeAddress"), variant: "destructive" },
      setDefault: { label: t("setDefaultAddress"), variant: "outline" },
    } as const
  )[operation];
  return (
    <form action={submit} className="grid gap-3">
      {operation === "add" ? null : (
        <input type="hidden" name="operation" value={operation} />
      )}
      {isEditor ? (
        <AddressFields address={address} reference={reference} />
      ) : (
        <input type="hidden" name="reference" value={reference} />
      )}
      {failure ? (
        <p role="alert" className="text-destructive text-sm">
          {failure.displayMessage}
        </p>
      ) : null}
      <div
        className={operation === "setDefault" ? "" : "flex justify-end gap-2"}
      >
        {isEditor ? (
          <DialogClose asChild>
            <Button disabled={pending} type="button" variant="outline">
              {t("cancelAddressChange")}
            </Button>
          </DialogClose>
        ) : null}
        {operation === "remove" ? (
          <AlertDialogCancel disabled={pending}>
            {t("cancelAddressChange")}
          </AlertDialogCancel>
        ) : null}
        <Button
          disabled={pending || needsRefresh}
          size={operation === "setDefault" ? "sm" : "default"}
          type="submit"
          variant={variant}
        >
          {pending ? t("saving") : label}
        </Button>
      </div>
    </form>
  );
};

export function CustomerAddressDialog({
  action,
  address,
  reference,
}: {
  readonly action: CustomerAccountAction;
  readonly address?: SavedAddressDetails["address"];
  readonly reference: string;
}) {
  const t = useTranslations("web.customerAccount");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {t(address ? "editAddress" : "addAddress")}
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {t(address ? "editAddressTitle" : "addAddress")}
          </DialogTitle>
        </DialogHeader>
        <AddressChangeForm
          action={action}
          address={address}
          operation={address ? "edit" : "add"}
          reference={reference}
          onSaved={() => {
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function SavedAddressCard({
  action,
  entry,
}: {
  readonly action: CustomerAccountAction;
  readonly entry: SavedAddressDetails;
}) {
  const t = useTranslations("web.customerAccount");
  const locale = useLocale();
  const [removeOpen, setRemoveOpen] = useState(false);
  const { address, defaultBilling, defaultShipping } = entry;
  const isDefault = defaultBilling && defaultShipping;
  const defaultLabel = defaultShipping
    ? t(defaultBilling ? "defaultAddress" : "defaultShippingAddress")
    : t("defaultBillingAddress");
  const country = address.country
    ? new Intl.DisplayNames([locale], { type: "region" }).of(address.country)
    : undefined;
  return (
    <div className="grid h-full content-start gap-4 rounded-md border p-4">
      <address className="grid gap-0.5 text-sm not-italic">
        <p className="font-medium">{address.addressLine1}</p>
        {address.addressLine2 ? <p>{address.addressLine2}</p> : null}
        <p>
          {[address.city, address.region, address.postalCode]
            .filter(Boolean)
            .join(", ")}
        </p>
        {country ? <p>{country}</p> : null}
      </address>
      {defaultShipping || defaultBilling ? (
        <Badge variant="secondary">{defaultLabel}</Badge>
      ) : null}
      <div className="flex flex-wrap items-start gap-2">
        <CustomerAddressDialog
          action={action}
          address={address}
          reference={entry.reference}
        />
        {isDefault ? null : (
          <AddressChangeForm
            action={action}
            operation="setDefault"
            reference={entry.reference}
          />
        )}
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost">
              {t("removeAddress")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("removeAddressTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("removeAddressDescription")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AddressChangeForm
              action={action}
              operation="remove"
              reference={entry.reference}
              onSaved={() => {
                setRemoveOpen(false);
              }}
            />
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
