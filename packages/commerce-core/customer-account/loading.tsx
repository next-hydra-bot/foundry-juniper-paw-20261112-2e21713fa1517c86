import { CustomerAreaContentSkeleton } from "@repo/design-system/components/layout/customer-area";
import {
  Card,
  CardContent,
  CardHeader,
} from "@repo/design-system/components/ui/card";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";

export function AccountHomeSkeleton() {
  return (
    <CustomerAreaContentSkeleton description={false}>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="grid gap-1">
          <Skeleton className="h-6 w-44 max-w-full" />
          <Skeleton className="h-5 w-56 max-w-full" />
        </CardContent>
      </Card>
    </CustomerAreaContentSkeleton>
  );
}
