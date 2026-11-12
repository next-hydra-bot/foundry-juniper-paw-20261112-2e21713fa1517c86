import { minorAmountFromDecimal } from "@repo/commerce-core/e2e/checkout-expectations";
import { expect } from "@repo/e2e-testing";
import type { Locator } from "@repo/e2e-testing";

export const expectMoney = async (
  observation: Locator,
  amount: string,
  currency: string
): Promise<void> => {
  await expect(observation).toHaveAttribute(
    "data-minor-amount",
    minorAmountFromDecimal(amount)
  );
  await expect(observation).toHaveAttribute("data-currency", currency);
};
