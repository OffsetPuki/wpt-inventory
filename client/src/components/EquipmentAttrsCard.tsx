import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Item, EquipmentPreset, CustomField } from "@shared/schema";
import { itemAttrs } from "@/lib/format";
import LucideIcon from "./LucideIcon";

export default function EquipmentAttrsCard({ item }: { item: Item }) {
  const { data: presets = [] } = useQuery<EquipmentPreset[]>({
    queryKey: ["equipment-presets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment-presets");
      return res.json();
    },
  });

  if (!item.equipmentType) return null;

  const preset = presets.find((p) => p.key === item.equipmentType);
  const fields: CustomField[] = preset
    ? (() => {
        try {
          return JSON.parse(preset.customFields as unknown as string);
        } catch {
          return [];
        }
      })()
    : [];

  const attrs = itemAttrs(item);

  // Only show fields with a non-empty value (so legacy items don't render blank rows).
  const rows = fields
    .map((f) => ({ field: f, value: attrs[f.key] }))
    .filter((r) => r.value !== undefined && r.value !== null && r.value !== "");

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <LucideIcon name={preset?.icon} className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold text-foreground">
          {preset?.label ?? "Equipment details"}
        </h2>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map(({ field, value }) => (
          <div key={field.key}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {field.label}
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              {value}
              {field.unit ? <span className="text-muted-foreground"> {field.unit}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
