import { Layer } from "effect";

import { ShopifyCompanyAdmin } from "../company/admin";
import { companyStorageLayer } from "../company/storage";

export const DEFAULT_REGISTRATION_CONTAINER = "b2b-registration-by-id";
export const DEFAULT_COMPANY_MEMBER_INVITATION_CONTAINER = "invitations";
export const versionedKeyValueStoreLayer = ({
  container,
}: {
  readonly container: string;
}) =>
  companyStorageLayer(container).pipe(Layer.provide(ShopifyCompanyAdmin.layer));
