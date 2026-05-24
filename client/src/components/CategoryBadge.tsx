import { cn } from "@/lib/utils";
import type { Category } from "@shared/schema";

const CATEGORY_STYLES: Record<Category, { bg: string; text: string; label: string }> = {
  electric: { bg: "bg-blue-500/15", text: "text-blue-400", label: "Electric" },
  welder: { bg: "bg-orange-500/15", text: "text-orange-400", label: "Welder" },
  it: { bg: "bg-purple-500/15", text: "text-purple-400", label: "IT" },
  raw_materials: { bg: "bg-green-500/15", text: "text-green-400", label: "Raw Materials" },
  tools: { bg: "bg-yellow-500/15", text: "text-yellow-400", label: "Tools" },
};

interface CategoryBadgeProps {
  category: Category;
  size?: "sm" | "md";
  className?: string;
}

export default function CategoryBadge({ category, size = "sm", className }: CategoryBadgeProps) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.tools;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        style.bg,
        style.text,
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm",
        className
      )}
    >
      {style.label}
    </span>
  );
}

export { CATEGORY_STYLES };
