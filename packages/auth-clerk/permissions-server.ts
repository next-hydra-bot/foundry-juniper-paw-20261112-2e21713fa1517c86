import "server-only";
import { auth } from "@clerk/nextjs/server";
import { Layer } from "effect";

import {
  clerkPermissionSessionLayerWith,
  permissionAdapterLayer,
  roleAssignmentsLayer,
} from "./permissions";

export const clerkPermissionSessionLayer = clerkPermissionSessionLayerWith({
  readSession: async () => await auth(),
});

export const storefrontPermissionAdapterLayer = permissionAdapterLayer({
  source: "metadata",
}).pipe(Layer.provide(clerkPermissionSessionLayer));

export const storefrontRoleAssignmentsLayer = roleAssignmentsLayer.pipe(
  Layer.provide(clerkPermissionSessionLayer)
);
