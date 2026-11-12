import { expect } from "@repo/e2e-testing";
import type { Locator, Page } from "@repo/e2e-testing";

const testGateway =
  /^(?:\(for testing\)\s*)?(?:Test payment gateway|Bogus Gateway)$/iu;

export class HostedCheckoutDriver {
  readonly #page: Page;
  readonly #origin: string;

  constructor(page: Page, origin: string | undefined) {
    const url = URL.parse(origin ?? "");
    if (url?.protocol !== "https:" || url.origin !== origin) {
      throw new Error(
        "Set E2E_SHOPIFY_CHECKOUT_ORIGIN to the dedicated Shopify sandbox's HTTPS checkout origin"
      );
    }
    this.#page = page;
    this.#origin = url.origin;
  }

  async #expectHostedPage(): Promise<void> {
    try {
      await expect
        .poll(() => new URL(this.#page.url()).origin === this.#origin, {
          message: "The browser reaches the configured Shopify sandbox",
          timeout: 30_000,
        })
        .toBeTruthy();
    } catch (error) {
      const signIn = this.#page.getByRole("heading", {
        name: /^Sign in to /iu,
      });
      if (await signIn.isVisible()) {
        throw new Error(
          "Shopify Customer Accounts prompted for sign-in again. The storefront session did not carry through the identity-provider handoff.",
          { cause: error }
        );
      }
      throw error;
    }
  }

  async #expectLine(product: string, quantity: number): Promise<Locator> {
    const line = this.#page.getByRole("row").filter({
      has: this.#page.getByText(product, { exact: true }),
    });
    const storePassword = this.#page.getByRole("textbox", {
      exact: true,
      name: "Enter store password",
    });
    await expect(line.or(storePassword)).toBeVisible();
    if (await storePassword.isVisible()) {
      throw new Error(
        "The Shopify sandbox redirected Checkout to its store password page. Use a sandbox with Checkout accessible to the test browser."
      );
    }
    await expect(
      line.getByText(String(quantity), { exact: true }).first()
    ).toBeVisible();
    return line;
  }

  async expectVariant(
    product: string,
    quantity: number,
    options: ReadonlyMap<string, string>
  ): Promise<void> {
    await this.#expectHostedPage();
    const line = await this.#expectLine(product, quantity);
    const variant = [...options.values()].join(" / ");
    await expect(line.getByText(variant, { exact: true })).toBeVisible();
  }

  async enterContactAndDelivery(
    fields: ReadonlyMap<string, string>
  ): Promise<void> {
    await this.#expectHostedPage();
    const field = (name: string) => {
      const value = fields.get(name);
      if (value === undefined) {
        throw new Error(`Missing Shopify Checkout field ${name}`);
      }
      return value;
    };
    await this.#page
      .getByRole("textbox", { name: /^Email(?: or mobile phone number)?$/iu })
      .fill(field("Email"));
    await this.#page
      .getByLabel("Country/Region", { exact: true })
      .selectOption(field("Country"));
    await this.#page
      .getByLabel("First name", { exact: true })
      .fill(field("First name"));
    await this.#page
      .getByLabel("Last name", { exact: true })
      .fill(field("Last name"));
    await this.#page
      .getByLabel("Address", { exact: true })
      .fill(field("Address"));
    await this.#page.getByLabel("City", { exact: true }).fill(field("City"));
    await this.#page
      .getByLabel("State", { exact: true })
      .selectOption(field("State"));
    await this.#page
      .getByLabel(/^(?:ZIP|Postal) code$/iu)
      .fill(field("Postal code"));
  }

  async #fillCardField(name: string, value: string): Promise<void> {
    const inline = this.#page.getByRole("textbox", {
      name: new RegExp(`^${name}`, "iu"),
    });
    const embedded = this.#page.locator(`iframe[title*="${name}" i]`);
    await expect(inline.or(embedded).first()).toBeVisible();
    if (await inline.isVisible()) {
      await inline.fill(value);
      return;
    }
    await embedded.contentFrame().locator("input").fill(value);
  }

  async payWithTestCard(): Promise<void> {
    await this.#expectHostedPage();
    // Never submit a payment unless the dedicated sandbox exposes its test gateway.
    await expect(this.#page.getByText(testGateway).first()).toBeVisible();
    const gatewayOption = this.#page.getByRole("radio", { name: testGateway });
    if (await gatewayOption.count()) {
      await gatewayOption.check();
    }
    // oxlint-disable-next-line effecttsgo/global-date -- The live browser checkout requires an unexpired test card.
    const expiry = String(new Date().getUTCFullYear() + 2).slice(-2);
    await this.#fillCardField("Card number", "1");
    await this.#fillCardField("Expiration date", `12/${expiry}`);
    await this.#fillCardField("Security code", "111");
    await this.#fillCardField("Name on card", "Test payment gateway");
    await this.#page
      .getByRole("button", { exact: true, name: "Pay now" })
      .click();
  }

  async expectOrderConfirmation(
    product: string,
    quantity: number
  ): Promise<void> {
    await this.#expectHostedPage();
    await expect(
      this.#page.getByText(/^(?:Order|Confirmation) #[\w-]+/iu).first()
    ).toBeVisible({ timeout: 30_000 });
    await this.#expectLine(product, quantity);
  }

  async expectCustomerEmail(email: string): Promise<void> {
    await this.#expectHostedPage();
    await expect(
      this.#page.getByText(email, { exact: true }).first()
    ).toBeVisible();
  }
}
