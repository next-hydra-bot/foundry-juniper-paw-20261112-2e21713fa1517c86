import { CustomerAreaContentSkeleton } from "@repo/design-system/components/layout/customer-area";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@repo/design-system/components/ui/card";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";

function Fields({ count }: { readonly count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={`field-${index}`} className="grid gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

export function CustomerProfileSkeleton() {
  return (
    <CustomerAreaContentSkeleton>
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36" />
          </CardHeader>
          <CardContent className="grid gap-4">
            <Fields count={2} />
            <div className="grid gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-28" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="items-center">
            <Skeleton className="h-6 w-36" />
            <CardAction>
              <Skeleton className="h-8 w-28" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-5 w-56 max-w-full" />
          </CardContent>
        </Card>
      </div>
    </CustomerAreaContentSkeleton>
  );
}
