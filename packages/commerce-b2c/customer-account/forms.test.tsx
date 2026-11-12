import {
  AddressBookReference,
  addressBookMutationRejected,
} from "@repo/commerce-core/domain/address-book";
import { NextIntlClientProvider } from "@repo/i18n";
import messages from "@repo/i18n/messages/en-US.json";
import { Option, Result, Schema } from "effect";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { CustomerAccountActionResult } from "./action-contract";
import { CustomerAddressDialog, CustomerProfileForm } from "./forms";
import { CustomerAddressInput } from "./schema";

const roots: ReturnType<typeof createRoot>[] = [];
const failure = Schema.encodeSync(CustomerAccountActionResult)(
  Result.fail({
    displayMessage: "Check this address.",
    error: addressBookMutationRejected({
      reference: AddressBookReference.make("new-address"),
      message: "Check this address.",
    }),
  })
);
const success = Schema.encodeSync(CustomerAccountActionResult)(
  Result.succeed(null)
);
const render = (children: ReactNode) => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en-US" messages={messages}>
        {children}
      </NextIntlClientProvider>
    );
  });
  return container;
};

const readForm = (container: HTMLElement) => {
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("Expected the account form");
  }
  form.noValidate = true;
  const field = (name: string) => {
    const input = container.querySelector(`input[name="${name}"]`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`Expected ${name}`);
    }
    return input;
  };
  return { container, form, field };
};

const openAddressForm = (container: HTMLElement) => {
  const trigger = container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]'
  );
  if (!trigger) {
    throw new Error("Expected the add address button");
  }
  act(() => {
    trigger.click();
  });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!dialog) {
    throw new Error("Expected the address dialog");
  }
  return readForm(dialog);
};

const enter = (input: HTMLInputElement, value: string) => {
  act(() => {
    // oxlint-disable-next-line typescript/unbound-method -- The native setter is called below with its input as `this`.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set;
    if (!setter) {
      throw new Error("Expected native input value setter");
    }
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const choose = async (container: HTMLElement, field: string, label: string) => {
  const trigger = container.querySelector(`button[id$="-${field}"]`);
  if (!trigger) {
    throw new Error(`Expected ${field} selector`);
  }
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    );
    await Promise.resolve();
  });
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (option) => option.textContent === label
  );
  if (!option) {
    throw new Error(`Expected ${label} option`);
  }
  act(() => {
    option.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};
const scrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
);

describe("customer account forms", () => {
  beforeAll(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn<HTMLElement["scrollIntoView"]>(),
    });
  });
  afterEach(() => {
    act(() => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
    });
    document.body.replaceChildren();
  });

  afterAll(() => {
    if (scrollIntoView) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        scrollIntoView
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("keeps profile edits visible when the action returns a failure", async () => {
    const { container, form, field } = readForm(
      render(
        <CustomerProfileForm
          action={async () => await Promise.resolve(failure)}
          profile={{
            email: "buyer@example.test",
            firstName: "Original",
            lastName: "Buyer",
          }}
        />
      )
    );
    enter(field("firstName"), "Edited");
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Check this address."
    );
    expect(field("firstName").value).toBe("Edited");
  });

  it.each([
    {
      country: "US",
      countryLabel: "United States",
      region: "NY",
      regionLabel: "New York",
    },
    {
      country: "CA",
      countryLabel: "Canada",
      region: "ON",
      regionLabel: "Ontario",
    },
  ])(
    "preserves $country/$region on retry and closes the dialog after saving",
    async ({ country, countryLabel, region, regionLabel }) => {
      const submissions: FormData[] = [];
      const page = render(
        <CustomerAddressDialog
          reference="new-address"
          action={async (_, form) => {
            submissions.push(form);
            return await Promise.resolve(
              submissions.length === 1 ? failure : success
            );
          }}
        />
      );
      const { container, form, field } = openAddressForm(page);
      enter(field("addressLine1"), "20 Oak Street");
      enter(field("city"), "New York");
      enter(field("postalCode"), "10002");
      await choose(container, "country", countryLabel);
      await choose(container, "region", regionLabel);
      await act(async () => {
        form.requestSubmit();
        await Promise.resolve();
      });
      expect({
        hasError: container.querySelector('[role="alert"]') !== null,
        street: field("addressLine1").value,
        countryLabel: container.querySelector('button[id$="-country"]')
          ?.textContent,
        regionLabel: container.querySelector('button[id$="-region"]')
          ?.textContent,
        country: new FormData(form).getAll("country"),
        region: new FormData(form).getAll("region"),
      }).toEqual({
        hasError: true,
        street: "20 Oak Street",
        countryLabel,
        regionLabel,
        country: [country],
        region: [region],
      });
      await act(async () => {
        form.requestSubmit();
        await Promise.resolve();
      });
      expect(
        submissions.map((form) => ({
          country: form.get("country"),
          region: form.get("region"),
        }))
      ).toEqual([
        { country, region },
        { country, region },
      ]);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      const reopened = openAddressForm(page);
      expect(reopened.field("addressLine1").value).toBe("");
      expect(new FormData(reopened.form).get("region")).toBe("");
    }
  );

  it("submits an unselected region as empty so required-region validation rejects it", () => {
    const { form, field } = openAddressForm(
      render(
        <CustomerAddressDialog
          reference="new-address"
          action={async () => await Promise.resolve(failure)}
        />
      )
    );
    enter(field("addressLine1"), "20 Oak Street");
    enter(field("city"), "New York");
    enter(field("postalCode"), "10002");
    const data = new FormData(form);
    expect(data.getAll("region")).toEqual([""]);
    expect(
      Option.isNone(
        Schema.decodeUnknownOption(Schema.fromFormData(CustomerAddressInput))(
          data
        )
      )
    ).toBeTruthy();
  });
});
