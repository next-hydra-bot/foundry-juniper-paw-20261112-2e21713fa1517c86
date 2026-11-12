"use server";

import { headers } from "next/headers";

import { customerAccountKeys } from "./keys";
import { prepareSignOutForRequest } from "./sign-out";

export async function prepareSignOut(): Promise<void> {
  const { SHOPIFY_STOREFRONT_ORIGIN: origin } = customerAccountKeys();
  await prepareSignOutForRequest(
    new Request(`${origin}/account/logout`, {
      headers: await headers(),
      method: "POST",
    })
  );
}
