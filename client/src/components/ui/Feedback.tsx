import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// Shared list-state placeholders lifted verbatim from the per-page copies so
// every CRUD page shows the same spinner and empty state.

/** Centered spinner shown while a query is loading. */
export function LoadingBlock() {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /><span>Loading…</span>
    </div>
  );
}

/** Large icon + message placeholder for an empty list; optional CTA as children. */
export function EmptyState({
  icon: Icon,
  message,
  children,
}: {
  icon: LucideIcon;
  message: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-muted-foreground">
      <Icon className="h-10 w-10 opacity-60" />
      <p className="max-w-lg text-base text-foreground">{message}</p>
      {children}
    </div>
  );
}
