import { Context } from "effect";
import type { Effect } from "effect";

import type { CustomerCommercePrincipal } from "../domain/commerce-request-context";
import type {
  CompanyProfile,
  CompanyProfileFailure,
  SaveCompanyProfileInput,
} from "../domain/company-profile";

/** Scope is supplied by the verified company purchasing context, never a form. */
export class CompanyProfiles extends Context.Service<
  CompanyProfiles,
  {
    readonly get: (
      principal: CustomerCommercePrincipal
    ) => Effect.Effect<CompanyProfile, CompanyProfileFailure>;
    readonly save: (
      principal: CustomerCommercePrincipal,
      input: SaveCompanyProfileInput
    ) => Effect.Effect<CompanyProfile, CompanyProfileFailure>;
  }
>()("@repo/commerce-core/CompanyProfiles") {}
