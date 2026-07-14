import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

// Shared list-state placeholders lifted verbatim from the per-page copies so
// every CRUD page shows the same spinner and empty state.

/** Centered spinner shown while a query is loading. */
export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin" />
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
    <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
      <Icon className="h-12 w-12" />
      <p className="text-lg">{message}</p>
      {children}
    </div>
  );
}
