import { CustomerAreaContentSkeleton } from "@repo/design-system/components/layout/customer-area";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";

/** The content boundary includes the compact toolbar and table, keeping the account shell stable. */
export function OrderRowsSkeleton() {
  return (
    <div role="status" aria-label="Loading orders" className="min-h-80 min-w-0">
      <span className="sr-only">Loading orders</span>
      <div aria-hidden="true">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div className="grid min-w-48 flex-1 gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
          <Skeleton className="h-9 w-20" />
          <div className="grid w-full gap-2 sm:w-40">
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-9 w-full" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Skeleton className="h-10 w-full rounded-none" />
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 border-t px-4 py-5 md:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <Skeleton className="h-6 w-20" />
              <Skeleton className="hidden h-6 w-24 md:block" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function OrderListingSkeleton() {
  return (
    <CustomerAreaContentSkeleton>
      <OrderRowsSkeleton />
    </CustomerAreaContentSkeleton>
  );
}

function OrderDetailBodySkeleton({
  emailAccess = false,
}: {
  readonly emailAccess?: boolean;
}) {
  return (
    <>
      {emailAccess ? null : <Skeleton className="mb-4 h-8 w-32" />}
      <div className="overflow-hidden rounded-xl border">
        <div className="grid gap-3 px-5 py-6 sm:px-6">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="border-t px-5 pt-5 sm:px-6">
          <Skeleton className="h-5 w-28" />
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <div className="grid content-center gap-2">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="h-4 w-28 max-w-full" />
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
            <Skeleton className="col-start-2 h-5 w-20 self-center sm:col-start-3" />
          </div>
        </div>
        <div className="border-t px-5 py-5 sm:px-6">
          <div className="ml-auto grid gap-3 sm:max-w-xs">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex justify-between gap-6">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
            <div className="mt-1 flex justify-between gap-6 border-t pt-4">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>
        </div>
        <div className="grid gap-6 border-t bg-muted/20 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {[0, 1, 2].map((column) => (
            <div
              key={column}
              className={
                column === 2
                  ? "grid gap-2 sm:col-span-2 lg:col-span-1"
                  : "grid gap-2"
              }
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-24 w-48 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export function OrderDetailSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading order"
      aria-busy="true"
      className="min-h-96 min-w-0"
    >
      <span className="sr-only">Loading order</span>
      <div aria-hidden="true">
        <OrderDetailBodySkeleton />
      </div>
    </div>
  );
}

export function EmailOrderDetailSkeleton() {
  return (
    <main aria-busy="true" className="mx-auto min-h-96 max-w-4xl px-4 py-8">
      <div role="status" aria-label="Loading order">
        <span className="sr-only">Loading order</span>
        <div aria-hidden="true">
          <OrderDetailBodySkeleton emailAccess />
        </div>
      </div>
    </main>
  );
}
