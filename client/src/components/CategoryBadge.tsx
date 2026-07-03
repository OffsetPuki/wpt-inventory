import { cn } from "@/lib/utils";
import type { Category } from "@shared/schema";
import { Zap, Flame, Monitor, Package, Wrench, type LucideIcon } from "lucide-react";

const CATEGORY_STYLES: Record<
  Category,
  { bg: string; text: string; iconColor: string; border: string; label: string; icon: LucideIcon }
> = {
  electric: { bg: "bg-blue-500/15", text: "text-blue-700 dark:text-blue-400", iconColor: "text-blue-500", border: "border-blue-500/30", label: "Electric", icon: Zap },
  welder: { bg: "bg-orange-500/15", text: "text-orange-700 dark:text-orange-400", iconColor: "text-orange-500", border: "border-orange-500/30", label: "Welder", icon: Flame },
  it: { bg: "bg-purple-500/15", text: "text-purple-700 dark:text-purple-400", iconColor: "text-purple-500", border: "border-purple-500/30", label: "IT", icon: Monitor },
  raw_materials: { bg: "bg-green-500/15", text: "text-green-700 dark:text-green-400", iconColor: "text-emerald-600", border: "border-emerald-500/30", label: "Raw Materials", icon: Package },
  tools: { bg: "bg-yellow-500/15", text: "text-yellow-700 dark:text-yellow-400", iconColor: "text-amber-500", border: "border-amber-500/30", label: "Tools", icon: Wrench },
};

interface CategoryBadgeProps {
  category: Category;
  size?: "sm" | "md";
  /** Frosted light pill for placing on top of photos. */
  overlay?: boolean;
  className?: string;
}

export default function CategoryBadge({ category, size = "sm", overlay = false, className }: CategoryBadgeProps) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.tools;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        overlay ? "bg-white/85 text-zinc-800 shadow-sm ring-1 ring-black/10 backdrop-blur-sm" : cn(style.bg, style.text),
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        className
      )}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-4 w-4", overlay ? style.iconColor : "")} />
      {style.label}
    </span>
  );
}

export { CATEGORY_STYLES };
