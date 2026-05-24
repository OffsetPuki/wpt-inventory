import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  CATEGORIES,
  AREAS,
  SHOP_AREAS,
  ITEM_TYPES,
  type Category,
  type Area,
  type ItemType,
  type EquipmentPreset,
  type CustomField,
} from "@shared/schema";
import { CATEGORY_LABELS, AREA_LABELS, ITEM_TYPE_LABELS, itemAttrs } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import PhotoSlots from "./PhotoSlots";
import LucideIcon from "./LucideIcon";
import { cn } from "@/lib/utils";
import { Zap, Flame, Cpu, Package, Wrench, X, Loader2 } from "lucide-react";

const CATEGORY_ICON: Record<Category, typeof Zap> = {
  electric: Zap,
  welder: Flame,
  it: Cpu,
  raw_materials: Package,
  tools: Wrench,
};

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-4 text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export interface ItemFormSeed {
  name?: string;
  partNumber?: string | null;
  mfgPartNumber?: string | null;
  category?: Category;
  equipmentType?: string | null;
  customAttrs?: Record<string, any> | string | null;
  photos?: string[] | string | null;
  photoUrl?: string | null;
  area?: Area | null;
  rackLetter?: string | null;
  rackLevel?: number | null;
  subLocation?: string | null;
  shelf?: string | null;
  bin?: string | null;
  quantity?: number;
  lowStockThreshold?: number;
  itemType?: ItemType;
  quantityReserved?: number;
  notes?: string | null;
}

interface ItemFormProps {
  mode: "create" | "edit";
  initial?: ItemFormSeed;
  submitting?: boolean;
  onSubmit: (payload: Record<string, any>) => void | Promise<void>;
}

function pruneAttrs(
  fields: CustomField[],
  attrs: Record<string, any>
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of fields) {
    const v = attrs[f.key];
    if (v === undefined || v === null) continue;
    if (typeof v === "number") {
      out[f.key] = v;
    } else if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") continue;
      if (f.kind === "number") {
        const n = Number(trimmed);
        if (!isNaN(n)) out[f.key] = n;
      } else {
        out[f.key] = trimmed;
      }
    }
  }
  return out;
}

export default function ItemForm({ mode, initial, submitting, onSubmit }: ItemFormProps) {
  const seed = initial ?? {};
  const { isManager } = useAuth();

  const [name, setName] = useState(seed.name ?? "");
  const [partNumber, setPartNumber] = useState(seed.partNumber ?? "");
  const [mfgPartNumber, setMfgPartNumber] = useState(seed.mfgPartNumber ?? "");
  const [category, setCategory] = useState<Category>(seed.category ?? "tools");
  const categoryTouched = useRef(false);

  const [equipmentType, setEquipmentType] = useState<string | null>(seed.equipmentType ?? null);
  const [attrs, setAttrs] = useState<Record<string, any>>(() =>
    typeof seed.customAttrs === "string"
      ? itemAttrs({ customAttrs: seed.customAttrs })
      : (seed.customAttrs as Record<string, any>) ?? {}
  );

  const [photos, setPhotos] = useState<string[]>(() => {
    let arr: string[] = [];
    if (Array.isArray(seed.photos)) {
      arr = seed.photos.slice();
    } else if (typeof seed.photos === "string" && seed.photos) {
      try {
        const p = JSON.parse(seed.photos);
        if (Array.isArray(p)) arr = p;
      } catch {
        /* ignore malformed */
      }
    }
    if (arr.length === 0 && seed.photoUrl) arr = [seed.photoUrl];
    while (arr.length < 5) arr.push("");
    return arr.slice(0, 5);
  });

  const [area, setArea] = useState<Area | "">(seed.area ?? "");
  const [rackLetter, setRackLetter] = useState(seed.rackLetter ?? "");
  const [rackLevel, setRackLevel] = useState<string>(
    seed.rackLevel != null ? String(seed.rackLevel) : ""
  );
  const [subLocation, setSubLocation] = useState(seed.subLocation ?? "");
  const [shelf, setShelf] = useState(seed.shelf ?? "");

  const [quantity, setQuantity] = useState<string>(String(seed.quantity ?? 0));
  const [lowStockThreshold, setLowStockThreshold] = useState<string>(
    String(seed.lowStockThreshold ?? 0)
  );
  const [itemType, setItemType] = useState<ItemType>(seed.itemType ?? "stock");
  const [quantityReserved, setQuantityReserved] = useState<string>(
    String(seed.quantityReserved ?? 0)
  );
  const [notes, setNotes] = useState(seed.notes ?? "");

  const { data: presets = [] } = useQuery<EquipmentPreset[]>({
    queryKey: ["equipment-presets"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/equipment-presets");
      return res.json();
    },
  });

  const enabledPresets = presets.filter((p) => p.enabled);
  const activePreset = presets.find((p) => p.key === equipmentType);
  const activeFields: CustomField[] = activePreset
    ? (() => {
        try {
          return JSON.parse(activePreset.customFields as unknown as string);
        } catch {
          return [];
        }
      })()
    : [];

  const isShopArea = area !== "" && (SHOP_AREAS as readonly string[]).includes(area);

  function selectPreset(p: EquipmentPreset) {
    setEquipmentType(p.key);
    if (!categoryTouched.current) setCategory(p.defaultCategory);
  }

  function chooseCategory(c: Category) {
    categoryTouched.current = true;
    setCategory(c);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, any> = {
      name: name.trim(),
      partNumber: partNumber.trim() || null,
      mfgPartNumber: mfgPartNumber.trim() || null,
      category,
      equipmentType: equipmentType || null,
      customAttrs: equipmentType ? pruneAttrs(activeFields, attrs) : {},
      photos,
      photoUrl: photos.find(Boolean) ?? null,
      area: area || null,
      rackLetter: isShopArea ? rackLetter.trim() || null : null,
      rackLevel: isShopArea && rackLevel ? Number(rackLevel) : null,
      subLocation: isShopArea ? subLocation.trim() || null : null,
      shelf: isShopArea ? shelf.trim() || null : null,
      quantity: Number(quantity) || 0,
      lowStockThreshold: Number(lowStockThreshold) || 0,
      itemType,
      quantityReserved: Number(quantityReserved) || 0,
      notes: notes.trim() || null,
    };
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Photos */}
      <Section title="Photos">
        <p className="mb-3 text-sm text-muted-foreground">
          Take the same five shots every time so anyone can find and identify the part.
        </p>
        <PhotoSlots photos={photos} onChange={setPhotos} />
      </Section>

      {/* Identity */}
      <Section title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Door seal, silicone"
                required
              />
            </Field>
          </div>
          <Field label="Part number">
            <input
              className={inputCls}
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
            />
          </Field>
          <Field label="Mfg part number">
            <input
              className={inputCls}
              value={mfgPartNumber}
              onChange={(e) => setMfgPartNumber(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      {/* Category */}
      <Section title="Category">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const selected = category === c;
            return (
              <button
                type="button"
                key={c}
                onClick={() => chooseCategory(c)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                )}
              >
                <Icon className="h-6 w-6" />
                <span className="text-sm font-medium">{CATEGORY_LABELS[c]}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Equipment type */}
      <Section title="Equipment type">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {enabledPresets.map((p) => {
            const selected = equipmentType === p.key;
            return (
              <button
                type="button"
                key={p.key}
                onClick={() => selectPreset(p)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border-2 p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40"
                )}
              >
                <LucideIcon name={p.icon} className="h-5 w-5 shrink-0 text-primary" />
                <span className="text-sm font-medium text-foreground">{p.label}</span>
              </button>
            );
          })}
        </div>

        {activePreset && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setEquipmentType(null)}
              className="mb-4 inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground hover:bg-destructive hover:text-destructive-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear {activePreset.label}
            </button>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activeFields.map((f) => (
                <Field key={f.key} label={f.unit ? `${f.label} (${f.unit})` : f.label}>
                  {f.kind === "select" ? (
                    <select
                      className={inputCls}
                      value={attrs[f.key] ?? ""}
                      onChange={(e) => setAttrs({ ...attrs, [f.key]: e.target.value })}
                    >
                      <option value="">—</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      type={f.kind === "number" ? "number" : "text"}
                      step="any"
                      placeholder={f.placeholder}
                      value={attrs[f.key] ?? ""}
                      onChange={(e) => setAttrs({ ...attrs, [f.key]: e.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Location */}
      <Section title="Location">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Area">
            <select
              className={inputCls}
              value={area}
              onChange={(e) => setArea(e.target.value as Area)}
            >
              <option value="">— Select area —</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {isShopArea && (
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Rack letter">
              <input
                className={inputCls}
                maxLength={1}
                value={rackLetter}
                onChange={(e) => setRackLetter(e.target.value.toUpperCase().slice(0, 1))}
                placeholder="A–Z"
              />
            </Field>
            <Field label="Rack level">
              <select
                className={inputCls}
                value={rackLevel}
                onChange={(e) => setRackLevel(e.target.value)}
              >
                <option value="">—</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </Field>
            <Field label="Sub-location">
              <input
                className={inputCls}
                value={subLocation}
                onChange={(e) => setSubLocation(e.target.value)}
                placeholder="e.g. North wall"
              />
            </Field>
            <Field label="Shelf">
              <input className={inputCls} value={shelf} onChange={(e) => setShelf(e.target.value)} />
            </Field>
          </div>
        )}
      </Section>

      {/* Stock */}
      <Section title="Stock & tracking">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Quantity">
            <input
              className={inputCls}
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          {isManager && (
            <Field label="Low-stock threshold">
              <input
                className={inputCls}
                type="number"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
              />
            </Field>
          )}
          <Field label="Item type">
            <select
              className={inputCls}
              value={itemType}
              onChange={(e) => setItemType(e.target.value as ItemType)}
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {isManager && (
            <Field label="Reserved quantity">
              <input
                className={inputCls}
                type="number"
                value={quantityReserved}
                onChange={(e) => setQuantityReserved(e.target.value)}
              />
            </Field>
          )}
        </div>
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <textarea
          className={cn(inputCls, "h-24 resize-y py-2")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything workers should know about this item…"
        />
      </Section>

      <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border bg-background/80 py-4 backdrop-blur">
        <button
          type="submit"
          disabled={submitting}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
          {mode === "create" ? "Add item" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
