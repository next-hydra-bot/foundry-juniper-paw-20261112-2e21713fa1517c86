import { commerceAccountLinks } from "./commerce-account-links";

type AccountLinks = { accountHref?: string; signUpHref?: string };
export function accountLinks(): AccountLinks {
  const result: AccountLinks = {};
  for (const links of [commerceAccountLinks]) {
    Object.assign(result, links);
  }
  return result;
}
