import { randomUUID } from "node:crypto";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Read the seed fixture at the Playwright boundary.
import { readFileSync } from "node:fs";

import type { AuthContext } from "@repo/auth-contract/e2e/auth-context";
import { CartDriver } from "@repo/commerce-core/e2e/drivers/cart.driver";
import { ProductDriver } from "@repo/commerce-core/e2e/drivers/product.driver";
import { expect, Given, Then, When } from "@repo/e2e-testing";
import type { DataTable, Page } from "@repo/e2e-testing";
import { Schema } from "effect";

import { HostedCheckoutDriver } from "../hosted-checkout.driver";

const seedCatalog = Schema.fromJsonString(
  Schema.Struct({
    defaultLocale: Schema.String,
    products: Schema.Array(
      Schema.Struct({ key: Schema.String, title: Schema.String })
    ),
  })
);

const hostedCheckout = (page: Page) =>
  new HostedCheckoutDriver(
    page,
    // oxlint-disable-next-line effecttsgo/process-env -- Browser test configuration belongs to the runner.
    process.env.E2E_SHOPIFY_CHECKOUT_ORIGIN
  );

async function openProduct(page: Page, name: string): Promise<void> {
  const file = new URL(
    "b2c.json",
    import.meta.resolve("@repo/commerce-core/catalog/files")
  );
  const catalog = Schema.decodeSync(seedCatalog)(readFileSync(file, "utf-8"));
  const product = catalog.products.find(({ title }) => title === name);
  if (product === undefined) {
    throw new Error(`The Shopify B2C seed catalog does not include ${name}`);
  }
  await page.goto(
    `/${catalog.defaultLocale}/products/${encodeURIComponent(product.key)}`
  );
  await expect(page.getByRole("heading", { exact: true, name })).toBeVisible();
}

function values(
  table: DataTable,
  firstColumn: string
): ReadonlyMap<string, string> {
  const [header, ...rows] = table.raw();
  if (
    header?.length !== 2 ||
    header[0] !== firstColumn ||
    header[1] !== "Value"
  ) {
    throw new Error(`Expected the table columns ${firstColumn} and Value`);
  }
  const entries = new Map<string, string>();
  for (const [key, value, ...extra] of rows) {
    if (!key || !value || extra.length > 0 || entries.has(key)) {
      throw new Error(`Expected one value per ${firstColumn}`);
    }
    entries.set(key, value);
  }
  return entries;
}

Given(
  "Product {string} is available for purchase",
  async ({ page }, name: string) => {
    hostedCheckout(page);
    await openProduct(page, name);
    await expect(
      page.getByRole("button", { name: "Add to Cart" })
    ).toBeEnabled();
  }
);

Given("I am shopping as a guest", async ({ page }) => {
  await expect(
    page.getByRole("link", { exact: true, name: "Sign in" })
  ).toBeVisible();
});

Given(
  "{string} has a Customer Account",
  async ({ auth }: { readonly auth: AuthContext }, name: string) => {
    const [firstName, ...lastNames] = name.trim().split(/\s+/u);
    if (!firstName || lastNames.length === 0) {
      throw new Error("A Customer Account fixture needs a first and last name");
    }
    await auth.givenUser(name, {
      application: "web",
      email: auth.emailAddressFor(`shopify-${randomUUID()}`),
      firstName,
      lastName: lastNames.join(" "),
    });
  }
);

When(
  "I open the Product Detail Page for {string}",
  async ({ page }, name: string) => {
    await openProduct(page, name);
  }
);

When(
  "the buyer selects the Product Variant with attributes:",
  async ({ page }, table: DataTable) => {
    await new ProductDriver(page).selectVariant(values(table, "Attribute"));
  }
);

When(
  "the buyer adds {int} unit of the selected Product Variant to their Cart",
  async ({ page }, quantity: number) => {
    await new ProductDriver(page).addSelectedVariantToCart(quantity);
  }
);

Then(
  "the Cart is open with {int} unit of Product {string}",
  async ({ page }, quantity: number, product: string) => {
    await new CartDriver(page).expectOpenWithProduct(quantity, product);
  }
);

When("I open the Cart", async ({ page }) => {
  await new CartDriver(page).open();
});

When("I proceed to Checkout from the Cart", async ({ page }) => {
  await new CartDriver(page).startCheckout();
});

Then(
  "Shopify Checkout shows {int} unit of Product {string} with options:",
  async ({ page }, quantity: number, product: string, table: DataTable) => {
    await hostedCheckout(page).expectVariant(
      product,
      quantity,
      values(table, "Option")
    );
  }
);

When(
  "I enter Contact and Delivery Details in Shopify Checkout:",
  async ({ page }, table: DataTable) => {
    await hostedCheckout(page).enterContactAndDelivery(values(table, "Field"));
  }
);

When("I pay with a test Card in Shopify Checkout", async ({ page }) => {
  await hostedCheckout(page).payWithTestCard();
});

Then(
  "Shopify Order Confirmation shows {int} unit of Product {string}",
  async ({ page }, quantity: number, product: string) => {
    await hostedCheckout(page).expectOrderConfirmation(product, quantity);
  }
);

Then(
  "Shopify Checkout shows the email for Customer {string}",
  async ({ auth, page }, name: string) => {
    const customer = auth.identityFor(name);
    if (customer === undefined) {
      throw new Error(`The scenario does not have a Customer named ${name}`);
    }
    await hostedCheckout(page).expectCustomerEmail(customer.email);
  }
);
