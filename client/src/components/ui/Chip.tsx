import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChipTone = "zinc" | "blue" | "amber" | "emerald" | "red" | "muted";

// Theme-safe status hues shared across the CRUD pages. Each pill is the same
// bg-{hue}-500/10 wash with a light/dark-aware text color; `muted` is the flat
// zinc used for terminal/void states. Add a hue here (not in a page) when a new
// status needs a color.
const TONE: Record<ChipTone, string> = {
  zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  red: "bg-red-500/10 text-red-700 dark:text-red-400",
  muted: "bg-zinc-500/10 text-zinc-500",
};

/**
 * Status pill. Pass `tone` for a palette color, or `className` to supply a
 * one-off color map (e.g. a per-category hue) while still sharing the base pill
 * shape.
 */
export function Chip({
  tone,
  className,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone && TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
