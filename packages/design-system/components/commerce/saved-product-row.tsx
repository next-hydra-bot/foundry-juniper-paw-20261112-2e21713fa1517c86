import type { ReactNode } from "react";

export function SavedProductList({
  children,
  busy,
}: {
  readonly children: ReactNode;
  readonly busy?: boolean;
}) {
  return (
    <ul aria-busy={busy} className="divide-y rounded-xl border px-4 sm:px-5">
      {children}
    </ul>
  );
}

/** Slots keep catalog models, mutations and loading data outside the design system. */
export function SavedProductRow({
  media,
  children,
  actions,
}: {
  readonly media: ReactNode;
  readonly children: ReactNode;
  readonly actions: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 py-5 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-5">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
        {media}
      </div>
      <div className="min-w-0 self-center">{children}</div>
      <div className="col-start-2 flex flex-wrap items-end gap-2 sm:col-start-3 sm:self-center sm:justify-end">
        {actions}
      </div>
    </li>
  );
}
