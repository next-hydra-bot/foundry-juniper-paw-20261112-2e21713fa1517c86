import { mergeTests } from "@playwright/test";
import { test as base } from "@repo/e2e-testing";

import { test as shopifyCheckoutTest } from "./shopify-b2c-checkout";

export const test = mergeTests(base, shopifyCheckoutTest);
