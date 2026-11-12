import { Layer } from "effect";

export const additionalCommerceServicesLayer = Layer.mergeAll(
  Layer.empty,
  ...[]
);
