import { createRevalidationHandler } from "@repo/next-config/revalidation";
import { revalidatePath, revalidateTag } from "next/cache";

import { env } from "@/env";

const handle = createRevalidationHandler({
  operations: { revalidatePath, revalidateTag },
  secret: () => env.REVALIDATION_SECRET,
});

export { handle as GET, handle as POST };
