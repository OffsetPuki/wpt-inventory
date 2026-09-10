import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  cloneElement,
} from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CATEGORIES,
  AREAS,
  ITEM_TYPES,
  type Category,
  type Area,
  type ItemType,
} from "@shared/schema";
import { STOCK_UNITS, UNIT_LABELS, fractionalUnit } from "@shared/inventory";
import { CATEGORY_LABELS, AREA_LABELS, ITEM_TYPE_LABELS } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import PhotoSlots from "./PhotoSlots";
export interface ItemFormSeed {
  id?: number;
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
  materialKey?: string | null;
  notes?: string | null;
  unit?: string;
  reorderTarget?: number;
  supplier?: string | null;
  lastCostCents?: number;
  detailVersion?: number;
}
interface Props {
  mode: "create" | "edit";
  initial?: ItemFormSeed;
  suggestion?: ItemFormSeed;
  submitting?: boolean;
  onSubmit: (
    payload: Record<string, any>,
    addAnother?: boolean,
  ) => Promise<unknown> | unknown;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {cloneElement(children as ReactElement<any>, { "aria-label": label })}
    </label>
  );
}
function photoArray(seed: ItemFormSeed) {
  try {
    const arr = Array.isArray(seed.photos)
      ? seed.photos
      : JSON.parse(seed.photos || "[]");
    return arr.length ? arr : [seed.photoUrl || ""];
  } catch {
    return [seed.photoUrl || ""];
  }
}
function initialFields(seed: ItemFormSeed = {}) {
  return {
    name: seed.name || "",
    category: seed.category || "raw_materials",
    itemType: seed.itemType || "raw_material",
    quantity: String(seed.quantity ?? 0),
    unit: seed.unit || "each",
    area: seed.area || "",
    rackLetter: seed.rackLetter || "",
    rackLevel: String(seed.rackLevel || ""),
    subLocation: seed.subLocation || "",
    shelf: seed.shelf || "",
    bin: seed.bin || "",
    partNumber: seed.partNumber || "",
    mfgPartNumber: seed.mfgPartNumber || "",
    notes: seed.notes || "",
    photos: photoArray(seed),
    lowStockThreshold: String(seed.lowStockThreshold ?? 0),
    reorderTarget: String(seed.reorderTarget ?? 0),
    supplier: seed.supplier || "",
    cost: seed.lastCostCents ? String(seed.lastCostCents / 100) : "",
    materialKey: seed.materialKey || "",
  };
}
export default function ItemForm({
  mode,
  initial = {},
  suggestion,
  submitting,
  onSubmit,
}: Props) {
  const { user, isElevated } = useAuth(),
    key = `cjm.inventory.draft.${user?.id}.${mode}.${initial.id || "new"}`;
  const defaults = () => {
    let recent = {};
    try {
      recent = JSON.parse(
        sessionStorage.getItem(`cjm.inventory.last.${user?.id}`) || "{}",
      );
    } catch {}
    return initialFields(
      mode === "create" ? { ...recent, ...initial } : initial,
    );
  };
  const [fields, setFields] = useState<ReturnType<typeof initialFields>>(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(key) || "null");
      if (draft && draft.version === initial.detailVersion)
        return { ...defaults(), ...draft.fields };
    } catch {}
    return defaults();
  });
  const draftRequestKey = useRef<string | null>(null);
  if (!draftRequestKey.current) {
    try {
      draftRequestKey.current =
        JSON.parse(sessionStorage.getItem(key) || "null")?.requestKey ||
        crypto.randomUUID();
    } catch {
      draftRequestKey.current = crypto.randomUUID();
    }
  }
  const [more, setMore] = useState(false),
    [error, setError] = useState("");
  const addAnother = useRef(false),
    categoryTouched = useRef(false);
  const patch = (values: Partial<typeof fields>) =>
    setFields((previous) => ({ ...previous, ...values }));
  useEffect(() => {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: initial.detailVersion,
          requestKey: draftRequestKey.current,
          fields,
        }),
      );
    } catch {}
  }, [fields, key]);
  useEffect(() => {
    if (!suggestion) return;
    setFields((previous) => ({
      ...previous,
      name: previous.name || suggestion.name || "",
      notes: previous.notes || suggestion.notes || "",
      category: categoryTouched.current
        ? previous.category
        : suggestion.category || previous.category,
      photos: [
        ...previous.photos.filter(Boolean),
        ...photoArray(suggestion).filter(Boolean),
      ].slice(0, 5),
    }));
  }, [suggestion]);
  const [duplicateQuery, setDuplicateQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setDuplicateQuery(
          new URLSearchParams({
            name: fields.name,
            partNumber: fields.partNumber,
            excludeId: String(initial.id || 0),
          }).toString(),
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [fields.name, fields.partNumber, initial.id]);
  const duplicates = useQuery<
    { id: number; name: string; area: Area | null; rackLetter: string | null }[]
  >({
    queryKey: ["inventory", "duplicates", duplicateQuery],
    enabled:
      !!duplicateQuery && !!(fields.name.trim() || fields.partNumber.trim()),
    queryFn: async ({ signal }) =>
      (
        await apiRequest(
          "GET",
          `/api/inventory/duplicates?${duplicateQuery}`,
          undefined,
          { signal },
        )
      ).json(),
  });
  const materials = useQuery<Record<string, { name?: string }>>({
    queryKey: ["inventory", "materials"],
    enabled: more && isElevated,
    queryFn: async () => {
      const [defaults, response] = await Promise.all([
        import("@/quote/data/priceBook.js"),
        apiRequest("GET", "/api/quotes/settings"),
      ]);
      const settings = await response.json();
      return {
        ...defaults.DEFAULT_PRICE_BOOK.materials,
        ...settings.priceBook?.materials,
      };
    },
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload: Record<string, any> = {
      name: fields.name.trim(),
      category: fields.category,
      itemType: fields.itemType,
      unit: fields.unit,
      area: fields.area || null,
      rackLetter: fields.rackLetter.trim() || null,
      rackLevel: fields.rackLevel ? Number(fields.rackLevel) : null,
      subLocation: fields.subLocation.trim() || null,
      shelf: fields.shelf.trim() || null,
      bin: fields.bin.trim() || null,
      partNumber: fields.partNumber.trim() || null,
      mfgPartNumber: fields.mfgPartNumber.trim() || null,
      notes: fields.notes.trim() || null,
      photos: fields.photos,
      photoUrl: fields.photos.find(Boolean) || null,
      materialKey: fields.materialKey || null,
      detailVersion: initial.detailVersion,
    };
    if (mode === "create") {
      payload.quantity = Number(fields.quantity);
      payload.requestKey = draftRequestKey.current;
    }
    if (isElevated) {
      payload.lowStockThreshold = Number(fields.lowStockThreshold);
      payload.reorderTarget = Number(fields.reorderTarget);
      payload.supplier = fields.supplier.trim() || null;
      payload.lastCostCents = Math.round(Number(fields.cost) * 100);
    }
    try {
      await onSubmit(payload, addAnother.current);

      draftRequestKey.current = crypto.randomUUID();
      try {
        sessionStorage.removeItem(key);
        sessionStorage.setItem(
          `cjm.inventory.last.${user?.id}`,
          JSON.stringify({
            category: fields.category,
            itemType: fields.itemType,
            area: fields.area,
            rackLetter: fields.rackLetter,
            rackLevel: fields.rackLevel,
            subLocation: fields.subLocation,
            shelf: fields.shelf,
            bin: fields.bin,
            unit: fields.unit,
          }),
        );
      } catch {}
      if (addAnother.current)
        setFields(
          initialFields({
            category: fields.category,
            itemType: fields.itemType,
            unit: fields.unit,
            area: (fields.area || undefined) as Area | undefined,
            rackLetter: fields.rackLetter,
            rackLevel: Number(fields.rackLevel) || undefined,
            subLocation: fields.subLocation,
            shelf: fields.shelf,
            bin: fields.bin,
          }),
        );
    } catch (e: any) {
      setError(
        e.message || "Could not save. Your draft is kept on this device.",
      );
    }
  }
  const text = (name: keyof typeof fields, label: string) => (
    <Field label={label}>
      <input
        className={inputCls}
        value={String(fields[name])}
        onChange={(e) => patch({ [name]: e.target.value })}
      />
    </Field>
  );
  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <Field label="Name">
          <input
            required
            maxLength={240}
            className={inputCls}
            value={fields.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Example: 2-inch square tube"
          />
        </Field>
        {!!duplicates.data?.length && (
          <div className="rounded-lg bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Similar items already exist</p>
            {duplicates.data.map((i) => (
              <p key={i.id}>
                <Link className="underline" href={`/item/${i.id}`}>
                  {i.name}
                </Link>{" "}
                · {i.area ? AREA_LABELS[i.area] : "No location"}
                {i.rackLetter ? ` · Rack ${i.rackLetter}` : ""}
              </p>
            ))}
            <p className="mt-1">
              Use an existing item for more stock, or save a separate item for
              another location.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Track as">
            <select
              className={inputCls}
              value={fields.itemType === "tool" ? "tool" : "material"}
              onChange={(e) => {
                categoryTouched.current = true;
                patch({
                  itemType: e.target.value === "tool" ? "tool" : "raw_material",
                  category:
                    e.target.value === "tool" ? "tools" : "raw_materials",
                  unit: e.target.value === "tool" ? "each" : fields.unit,
                });
              }}
            >
              <option value="material">Material / supplies</option>
              <option value="tool">Reusable tool</option>
            </select>
          </Field>
          <Field label="Category">
            <select
              className={inputCls}
              value={fields.category}
              onChange={(e) => {
                categoryTouched.current = true;
                patch({ category: e.target.value as Category });
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {mode === "create" ? (
            <Field label="Starting quantity">
              <input
                required
                min="0"
                type="number"
                step={fractionalUnit(fields.unit) ? "0.0001" : "1"}
                className={inputCls}
                value={fields.quantity}
                onChange={(e) => patch({ quantity: e.target.value })}
              />
            </Field>
          ) : (
            <div className="text-sm">
              <p className="font-medium">On hand</p>
              <p className="mt-2">
                {initial.quantity} {initial.unit}
              </p>
              <p className="text-xs text-muted-foreground">
                Use stock actions to change this count.
              </p>
            </div>
          )}
          <Field label="Stock unit">
            <select
              className={inputCls}
              value={fields.unit}
              onChange={(e) => patch({ unit: e.target.value })}
            >
              {STOCK_UNITS.filter(
                (u) => fields.itemType !== "tool" || u === "each",
              ).map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {mode === "edit" && fields.unit !== initial.unit && (
          <p className="text-sm text-amber-700">
            Changing the unit label does not convert the existing quantity.
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <Field label="Location">
          <select
            className={inputCls}
            value={fields.area}
            onChange={(e) => patch({ area: e.target.value as Area })}
          >
            <option value="">Choose location</option>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </Field>
        {fields.area && (
          <div className="grid grid-cols-2 gap-3">
            {text("rackLetter", "Rack")}
            {text("shelf", "Shelf")}
            {text("bin", "Bin")}
            {text("subLocation", "Position / notes")}
          </div>
        )}
      </section>
      <section className="rounded-xl border bg-card p-4">
        <p className="mb-2 text-sm font-medium">Photo (optional)</p>
        <PhotoSlots
          photos={fields.photos}
          onChange={(photos) => patch({ photos })}
          compact={!more}
        />
      </section>
      <button
        type="button"
        className="text-sm text-primary underline"
        aria-expanded={more}
        onClick={() => setMore((v) => !v)}
      >
        {more ? "Hide details" : "More details"}
      </button>
      {more && (
        <section className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
          {text("partNumber", "Part number")}
          {text("mfgPartNumber", "Manufacturer part number")}
          {text("rackLevel", "Rack level")}
          <Field label="Item type">
            <select
              className={inputCls}
              value={fields.itemType}
              onChange={(e) => patch({ itemType: e.target.value as ItemType })}
            >
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ITEM_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          {isElevated && (
            <>
              {text("lowStockThreshold", "Low-stock alert at")}
              {text("reorderTarget", "Restock target")}
              {text("supplier", "Preferred supplier")}
              {text("cost", `Last cost per ${fields.unit} ($)`)}
              <Field label="Quote material">
                <select
                  className={inputCls}
                  value={fields.materialKey}
                  onChange={(e) => patch({ materialKey: e.target.value })}
                >
                  <option value="">No quote material</option>
                  {fields.materialKey &&
                    !materials.data?.[fields.materialKey] && (
                      <option value={fields.materialKey}>
                        {fields.materialKey}
                      </option>
                    )}
                  {Object.entries(materials.data || {}).map(([id, m]) => (
                    <option key={id} value={id}>
                      {m.name || id}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                className={`${inputCls} h-24 py-2`}
                value={fields.notes}
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </Field>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="sticky bottom-0 flex flex-wrap gap-2 border-t bg-background py-3">
        <button
          type="submit"
          disabled={submitting}
          onClick={() => {
            addAnother.current = false;
          }}
          className={primaryBtn}
        >
          {submitting
            ? "Saving…"
            : mode === "create"
              ? "Save item"
              : "Save changes"}
        </button>
        {mode === "create" && (
          <button
            type="submit"
            disabled={submitting}
            className={secondaryBtn}
            onClick={() => {
              addAnother.current = true;
            }}
          >
            Save and add another
          </button>
        )}
        <span className="self-center text-xs text-muted-foreground">
          Draft kept on this device
        </span>
      </div>
    </form>
  );
}
