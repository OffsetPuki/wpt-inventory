import * as Lucide from "lucide-react";
import { Box } from "lucide-react";

function toPascal(name: string): string {
  return name
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

export default function LucideIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const pascal = name ? toPascal(name) : "";
  const Cmp =
    ((Lucide as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
      pascal
    ]) || Box;
  return <Cmp className={className} />;
}
