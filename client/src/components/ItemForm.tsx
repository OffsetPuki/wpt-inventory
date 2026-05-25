import { useState, type ReactNode } from "react";
import {
  CATEGORIES,
  AREAS,
  ITEM_TYPES,
  type Category,
  type Area,
  type ItemType,
} from "@shared/schema";
import { CATEGORY_LABELS, AREA_LABELS, ITEM_TYPE_LABELS, itemAttrs } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import PhotoSlots from "./PhotoSlots";
import { cn } from "@/lib/utils";
import { Zap, Flame, Cpu, Package, Wrench, Loader2 } from "lucide-react";

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

export default function ItemForm({ mode, initial, submitting, onSubmit }: ItemFormProps) {
  const seed = initial ?? {};
  const { isManager } = useAuth();

  // Equipment-type details are no longer edited in this form, but we preserve any
  // existing values so editing an item never wipes them.
  const initialEquipmentType = seed.equipmentType ?? null;
  const initialAttrs =
    typeof seed.customAttrs === "string"
      ? itemAttrs({ customAttrs: seed.customAttrs })
      : (seed.customAttrs as Record<string, any>) ?? {};

  const [name, setName] = useState(seed.name ?? "");
  const [partNumber, setPartNumber] = useState(seed.partNumber ?? "");
  const [mfgPartNumber, setMfgPartNumber] = useState(seed.mfgPartNumber ?? "");
  const [category, setCategory] = useState<Category>(seed.category ?? "tools");

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

  // Containers use Front/Middle/Back + Left/Right instead of rack letter/level,
  // stored together in subLocation as e.g. "Front · Left".
  const seedIsContainer =
    seed.area === "shipping_container_1" || seed.area === "shipping_container_2";
  const [seedPos, seedSide] = seedIsContainer ? (seed.subLocation ?? "").split(" · ") : [];
  const [containerPos, setContainerPos] = useState(seedPos ?? "");
  const [containerSide, setContainerSide] = useState(seedSide ?? "");

  const [quantity, setQuantity] = useState<string>(String(seed.quantity ?? 0));
  const [lowStockThreshold, setLowStockThreshold] = useState<string>(
    String(seed.lowStockThreshold ?? 0)
  );
  const [itemType, setItemType] = useState<ItemType>(seed.itemType ?? "stock");
  const [quantityReserved, setQuantityReserved] = useState<string>(
    String(seed.quantityReserved ?? 0)
  );
  const [notes, setNotes] = useState(seed.notes ?? "");

  // Every area gets full location detail (rack / level / sub-location / shelf).
  const showLocation = area !== "";
  const isContainer = area === "shipping_container_1" || area === "shipping_container_2";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, any> = {
      name: name.trim(),
      partNumber: partNumber.trim() || null,
      mfgPartNumber: mfgPartNumber.trim() || null,
      category,
      equipmentType: initialEquipmentType,
      customAttrs: initialAttrs,
      photos,
      photoUrl: photos.find(Boolean) ?? null,
      area: area || null,
      rackLetter: showLocation && !isContainer ? rackLetter.trim() || null : null,
      rackLevel: showLocation && !isContainer && rackLevel ? Number(rackLevel) : null,
      subLocation: showLocation
        ? isContainer
          ? [containerPos, containerSide].filter(Boolean).join(" · ") || null
          : subLocation.trim() || null
        : null,
      shelf: showLocation && !isContainer ? shelf.trim() || null : null,
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
                onClick={() => setCategory(c)}
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

        {showLocation && isContainer && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Position in container">
              <select
                className={inputCls}
                value={containerPos}
                onChange={(e) => setContainerPos(e.target.value)}
              >
                <option value="">— Select —</option>
                <option value="Front">Front</option>
                <option value="Middle">Middle</option>
                <option value="Back">Back</option>
              </select>
            </Field>
            {containerPos && (
              <Field label="Side of container">
                <select
                  className={inputCls}
                  value={containerSide}
                  onChange={(e) => setContainerSide(e.target.value)}
                >
                  <option value="">— Select —</option>
                  <option value="Left">Left</option>
                  <option value="Right">Right</option>
                </select>
              </Field>
            )}
          </div>
        )}

        {showLocation && !isContainer && (
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
