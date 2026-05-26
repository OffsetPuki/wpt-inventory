import {
  Box,
  Flame,
  Gauge,
  Thermometer,
  ArrowDownUp,
  Cpu,
  ShieldCheck,
  Truck,
  ClipboardList,
  Package,
  Wrench,
  Zap,
  Monitor,
  Hammer,
  Settings,
  Plug,
  type LucideIcon as LucideIconType,
} from "lucide-react";

// Curated map of icons that user data (equipment presets / job templates) may
// reference by name. Keeping this list explicit means we only ship a few KB of
// icons instead of all ~1000 from lucide-react. Add new entries here if a new
// preset/template icon is needed.
const ICONS: Record<string, LucideIconType> = {
  box: Box,
  flame: Flame,
  gauge: Gauge,
  thermometer: Thermometer,
  "arrow-down-up": ArrowDownUp,
  cpu: Cpu,
  "shield-check": ShieldCheck,
  truck: Truck,
  "clipboard-list": ClipboardList,
  package: Package,
  wrench: Wrench,
  zap: Zap,
  monitor: Monitor,
  hammer: Hammer,
  settings: Settings,
  plug: Plug,
};

export default function LucideIcon({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) {
  const key = (name || "").toLowerCase();
  const Cmp = ICONS[key] || Box;
  return <Cmp className={className} />;
}
