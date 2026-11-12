import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CustomerRegistrationForm } from "./form";

describe(CustomerRegistrationForm, () => {
  it("keeps person and address fields while omitting company and authority fields", () => {
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en-US" messages={messages} timeZone="UTC">
        <CustomerRegistrationForm
          action={async () =>
            await Promise.resolve({ _tag: "Success", success: null })
          }
          profile={{
            email: "person@example.com",
            firstName: "Grace",
            lastName: "Hopper",
          }}
        />
      </NextIntlClientProvider>
    );
    for (const name of [
      "firstName",
      "lastName",
      "addressLine1",
      "city",
      "postalCode",
      "region",
    ]) {
      expect(markup).toContain(`name="${name}"`);
    }
    for (const name of [
      "companyName",
      "companyPhone",
      "vatId",
      "roles",
      "authUserId",
      "customerId",
      "businessUnitId",
      "email",
    ]) {
      expect(markup).not.toContain(`name="${name}"`);
    }
    expect(markup).toContain("person@example.com");
    expect(markup).toContain("readOnly");
    expect(markup).not.toContain("Register company");
  });
});
