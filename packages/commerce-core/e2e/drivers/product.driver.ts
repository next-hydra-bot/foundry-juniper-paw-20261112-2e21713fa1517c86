import { expect } from "@repo/e2e-testing";
import type { Page } from "@repo/e2e-testing";

import { matchesVariantAttributes } from "../checkout-expectations";

export class ProductDriver {
  readonly #page: Page;

  constructor(page: Page) {
    this.#page = page;
  }

  async selectVariant(attributes: ReadonlyMap<string, string>): Promise<void> {
    if (attributes.size === 0) {
      throw new Error("The Product Variant must define at least one attribute");
    }

    const selectOption = async (name: string, value: string) => {
      const radio = this.#page
        .getByRole("radiogroup", { exact: true, name })
        .getByRole("radio", { exact: true, name: value });
      await expect(radio).toBeEnabled();
      await radio.click();
      await expect(radio).toBeChecked();
    };
    for (const [name, value] of attributes) {
      // oxlint-disable-next-line no-await-in-loop -- Each option changes the current combination before the next choice.
      await selectOption(name, value);
    }
    const rendered = await this.#page
      .locator('[data-commerce-product-option][data-state="checked"]')
      .evaluateAll((markers) =>
        markers.map((marker) => ({
          name: marker.dataset.productOptionName ?? "",
          value: marker.dataset.productOptionValue ?? "",
        }))
      );
    expect(matchesVariantAttributes(rendered, attributes)).toBeTruthy();
  }

  async addSelectedVariantToCart(quantity: number): Promise<void> {
    const quantityInput = this.#page.getByLabel("Quantity", { exact: true });
    await quantityInput.fill(String(quantity));
    await quantityInput.blur();
    await this.#page.getByRole("button", { name: "Add to Cart" }).click();
    await expect(this.#page.getByRole("dialog")).toBeVisible();
  }
}
