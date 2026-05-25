import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { AREAS, type Item, type MapLayout, type MapNode, type Area } from "@shared/schema";
import { isLowStock, AREA_LABELS, locationString, itemPhotos } from "@/lib/format";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Eye,
  Plus,
  Trash2,
  Save,
  Loader2,
  Map as MapIcon,
  ZoomIn,
  ZoomOut,
  Maximize,
  Package,
  ChevronRight,
} from "lucide-react";

const VW = 1500;
const VH = 900;
const MIN_W = VW * 0.35; // most zoomed-in
const MAX_W = VW; // most zoomed-out = the full floor (no empty margin)

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
const FULL_VIEW: View = { x: 0, y: 0, w: VW, h: VH };

// Keep the view box inside the canvas so you can never pan off into empty space.
function clampView(v: View): View {
  return {
    ...v,
    x: clamp(v.x, Math.min(0, VW - v.w), Math.max(0, VW - v.w)),
    y: clamp(v.y, Math.min(0, VH - v.h), Math.max(0, VH - v.h)),
  };
}

function parseNodes(layout: MapLayout): MapNode[] {
  try {
    return JSON.parse(layout.nodes as unknown as string);
  } catch {
    return [];
  }
}

function nodeMatches(node: MapNode, item: Item): boolean {
  if (node.matchRack && item.rackLetter === node.matchRack) return true;
  if (node.matchSubLocation && item.subLocation === node.matchSubLocation) return true;
  return false;
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

// Add / rename / delete a floor (map layout). Backed by the /api/map-layouts CRUD.
function FloorDialog({
  open,
  editing,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  editing: MapLayout | null;
  onClose: () => void;
  onSaved: (key: string) => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [area, setArea] = useState<Area>("main_shop");

  useEffect(() => {
    if (open) {
      setLabel(editing?.label ?? "");
      setArea((editing?.area as Area) ?? "main_shop");
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async (): Promise<string> => {
      if (editing) {
        await apiRequest("PUT", `/api/map-layouts/${editing.key}`, { label: label.trim(), area });
        return editing.key;
      }
      const key = `${slugify(label) || "floor"}_${Date.now().toString(36)}`;
      await apiRequest("POST", "/api/map-layouts", { key, label: label.trim(), area, nodes: [] });
      return key;
    },
    onSuccess: (key) => {
      qc.invalidateQueries({ queryKey: ["map-layouts"] });
      toast({ variant: "success", title: editing ? "Floor updated" : "Floor added" });
      onSaved(key);
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/map-layouts/${editing!.key}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map-layouts"] });
      toast({ variant: "success", title: "Floor deleted" });
      onDeleted();
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Delete failed", description: e?.message }),
  });

  const fieldCls =
    "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit floor" : "Add floor"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) {
            toast({ variant: "destructive", title: "Floor name is required" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Floor name</span>
          <input
            className={fieldCls}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. North Yard"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Storage area</span>
          <select className={fieldCls} value={area} onChange={(e) => setArea(e.target.value as Area)}>
            {AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABELS[a]}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Items assigned to this area appear on this floor's map.
          </span>
        </label>

        <div className="mt-1 flex items-center justify-between gap-3">
          {editing ? (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Delete floor "${editing.label}"? Any nodes placed on it will be removed.`))
                  del.mutate();
              }}
              disabled={del.isPending}
              className="flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" /> Delete floor
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editing ? "Save" : "Add floor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function MapPage() {
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<
    | null
    | { mode: "move" | "resize"; id: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);
  const pan = useRef<null | { sx: number; sy: number; ox: number; oy: number }>(null);
  // Tracks whether the last pointer interaction was a drag, so a drag-to-pan
  // doesn't get mistaken for a click that opens a rack's contents.
  const didPan = useRef(false);

  const [activeKey, setActiveKey] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [nodes, setNodes] = useState<MapNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(FULL_VIEW);
  const [viewNode, setViewNode] = useState<MapNode | null>(null);
  const [floorDialog, setFloorDialog] = useState<{ open: boolean; editing: MapLayout | null }>({
    open: false,
    editing: null,
  });

  const { data: layouts = [] } = useQuery<MapLayout[]>({
    queryKey: ["map-layouts"],
    queryFn: async () => (await apiRequest("GET", "/api/map-layouts")).json(),
  });
  const { data: items = [] } = useQuery<Item[]>({
    queryKey: ["items", {}],
    queryFn: async () => (await apiRequest("GET", "/api/items")).json(),
  });

  const active = layouts.find((l) => l.key === activeKey) ?? layouts[0];

  useEffect(() => {
    if (active) {
      setActiveKey(active.key);
      setNodes(parseNodes(active));
      setSelectedId(null);
      setEditMode(false);
      setView(FULL_VIEW);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key]);

  // Zoom toward a screen point (cursor or canvas center).
  function zoomBy(factor: number, clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => {
      const nw = clamp(v.w * factor, MIN_W, MAX_W);
      const nh = nw * (VH / VW);
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;
      const cx = v.x + px * v.w;
      const cy = v.y + py * v.h;
      return clampView({ x: cx - px * nw, y: cy - py * nh, w: nw, h: nh });
    });
  }
  function zoomCenter(factor: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomBy(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // Wheel zoom (non-passive so we can preventDefault page scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.85 : 1 / 0.85, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", `/api/map-layouts/${active!.key}`, { nodes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map-layouts"] });
      toast({ variant: "success", title: "Map saved" });
      setEditMode(false);
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Save failed", description: e?.message }),
  });

  function toSvgCoords(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: view.x + ((e.clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((e.clientY - rect.top) / rect.height) * view.h,
    };
  }

  function startMove(e: React.PointerEvent, n: MapNode) {
    if (!editMode) return; // view mode: let it bubble to the svg for panning
    e.stopPropagation();
    const p = toSvgCoords(e);
    drag.current = { mode: "move", id: n.id, sx: p.x, sy: p.y, ox: n.x, oy: n.y, ow: n.w, oh: n.h };
    setSelectedId(n.id);
  }
  function startResize(e: React.PointerEvent, n: MapNode) {
    e.stopPropagation();
    const p = toSvgCoords(e);
    drag.current = { mode: "resize", id: n.id, sx: p.x, sy: p.y, ox: n.x, oy: n.y, ow: n.w, oh: n.h };
  }
  function startPan(e: React.PointerEvent) {
    if (drag.current) return; // a node interaction is in progress
    pan.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    didPan.current = false;
  }
  function onMove(e: React.PointerEvent) {
    if (pan.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const p = pan.current; // capture before setView so the updater stays pure
      if (Math.abs(e.clientX - p.sx) > 4 || Math.abs(e.clientY - p.sy) > 4) didPan.current = true;
      const nx = p.ox - (e.clientX - p.sx) * (view.w / rect.width);
      const ny = p.oy - (e.clientY - p.sy) * (view.h / rect.height);
      setView((v) => clampView({ ...v, x: nx, y: ny }));
      return;
    }
    if (!drag.current) return;
    const p = toSvgCoords(e);
    const d = drag.current;
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== d.id) return n;
        if (d.mode === "move") {
          return {
            ...n,
            x: Math.max(0, Math.min(VW - n.w, d.ox + (p.x - d.sx))),
            y: Math.max(0, Math.min(VH - n.h, d.oy + (p.y - d.sy))),
          };
        }
        return {
          ...n,
          w: Math.max(60, d.ow + (p.x - d.sx)),
          h: Math.max(40, d.oh + (p.y - d.sy)),
        };
      })
    );
  }
  function endDrag() {
    drag.current = null;
    pan.current = null;
  }

  function addNode() {
    const id = `n${Date.now()}`;
    const n: MapNode = { id, kind: "rack", label: "New rack", x: 60, y: 60, w: 160, h: 100 };
    setNodes((prev) => [...prev, n]);
    setSelectedId(id);
  }
  function updateNode(id: string, patch: Partial<MapNode>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }
  function deleteNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setSelectedId(null);
  }

  if (layouts.length === 0) {
    return (
      <div className="mx-auto max-w-5xl">
        <Header title="Shop Map" />
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <MapIcon className="h-12 w-12" />
          <p>No shop maps yet. Create one in Settings.</p>
        </div>
      </div>
    );
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Shop Map" description="Where everything lives on the floor">
        {isManager && active && (
          editMode ? (
            <>
              <button
                onClick={addNode}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-foreground hover:border-primary"
              >
                <Plus className="h-5 w-5" /> Add node
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              >
                {save.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
            >
              <Pencil className="h-5 w-5" /> Edit map
            </button>
          )
        )}
        {editMode && (
          <button
            onClick={() => {
              setNodes(parseNodes(active!));
              setEditMode(false);
            }}
            className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-muted-foreground hover:text-foreground"
          >
            <Eye className="h-5 w-5" /> Cancel
          </button>
        )}
      </Header>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto">
        {layouts.map((l) => (
          <button
            key={l.key}
            onClick={() => setActiveKey(l.key)}
            className={cn(
              "shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
              l.key === active?.key
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {l.label}
          </button>
        ))}
        {isManager && (
          <>
            <button
              onClick={() => setFloorDialog({ open: true, editing: null })}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Plus className="h-4 w-4" /> Add floor
            </button>
            {active && (
              <button
                onClick={() => setFloorDialog({ open: true, editing: active })}
                title={`Rename or delete ${active.label}`}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
              >
                <Pencil className="h-4 w-4" /> Edit floor
              </button>
            )}
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="relative rounded-xl border border-border bg-card p-2">
          {/* Zoom controls */}
          <div className="absolute right-4 top-4 z-10 flex flex-col gap-1.5">
            <button
              onClick={() => zoomCenter(0.8)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:border-primary"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-5 w-5" />
            </button>
            <button
              onClick={() => zoomCenter(1.25)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:border-primary"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-5 w-5" />
            </button>
            <button
              onClick={() => setView(FULL_VIEW)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm hover:border-primary"
              aria-label="Reset zoom"
            >
              <Maximize className="h-5 w-5" />
            </button>
          </div>

          <svg
            ref={svgRef}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            className={cn(
              "h-auto w-full touch-none select-none rounded-lg bg-background",
              editMode ? "cursor-default" : "cursor-grab active:cursor-grabbing"
            )}
            onPointerDown={startPan}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* Blueprint-style blue grid */}
            <defs>
              <pattern id="mapGridMinor" width={40} height={40} patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(205 90% 60% / 0.16)" strokeWidth={1} />
              </pattern>
              <pattern id="mapGrid" width={200} height={200} patternUnits="userSpaceOnUse">
                <rect width={200} height={200} fill="url(#mapGridMinor)" />
                <path d="M 200 0 L 0 0 0 200" fill="none" stroke="hsl(205 95% 65% / 0.32)" strokeWidth={1.5} />
              </pattern>
            </defs>
            <rect x={0} y={0} width={VW} height={VH} fill="hsl(210 80% 50% / 0.05)" />
            <rect x={0} y={0} width={VW} height={VH} fill="url(#mapGrid)" />

            {nodes.map((n) => {
              const matched = active
                ? items.filter((i) => i.area === active.area && nodeMatches(n, i))
                : [];
              const units = matched.reduce((s, i) => s + i.quantity, 0);
              const low = matched.some((i) => isLowStock(i));
              const hasItems = matched.length > 0;

              // Doors and machines are structural — no storage label.
              const structural = n.kind === "door" || n.kind === "machine";
              let countLine: string;
              if (structural) {
                countLine = "";
              } else if (editMode) {
                countLine = n.matchRack
                  ? `Rack ${n.matchRack}`
                  : n.matchSubLocation
                    ? n.matchSubLocation
                    : "(no match)";
              } else if (hasItems) {
                countLine = `${units} units`;
              } else if (n.matchSubLocation) {
                countLine = n.matchSubLocation;
              } else if (n.matchRack) {
                countLine = `Rack ${n.matchRack}`;
              } else {
                countLine = "empty";
              }

              const fill = !hasItems
                ? "hsl(var(--muted))"
                : low
                  ? "hsl(24 90% 50% / 0.18)"
                  : "hsl(173 58% 39% / 0.18)";
              const stroke =
                selectedId === n.id
                  ? "hsl(var(--primary))"
                  : low
                    ? "hsl(24 90% 50%)"
                    : hasItems
                      ? "hsl(173 58% 45%)"
                      : "hsl(var(--border))";

              return (
                <g
                  key={n.id}
                  onPointerDown={(e) => startMove(e, n)}
                  onClick={() => {
                    if (!editMode && !didPan.current) setViewNode(n);
                  }}
                  style={{ cursor: editMode ? "move" : structural ? "inherit" : "pointer" }}
                >
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.w}
                    height={n.h}
                    rx={8}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={selectedId === n.id ? 3 : 2}
                  />
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + n.h / 2 - 6}
                    textAnchor="middle"
                    fill="hsl(var(--foreground))"
                    fontSize={18}
                    fontWeight={600}
                  >
                    {n.label}
                  </text>
                  <text
                    x={n.x + n.w / 2}
                    y={n.y + n.h / 2 + 16}
                    textAnchor="middle"
                    fill="hsl(var(--muted-foreground))"
                    fontSize={14}
                  >
                    {countLine}
                  </text>
                  {low && <circle cx={n.x + n.w - 12} cy={n.y + 12} r={6} fill="hsl(24 90% 50%)" />}
                  {editMode && (
                    <rect
                      x={n.x + n.w - 14}
                      y={n.y + n.h - 14}
                      width={14}
                      height={14}
                      fill="hsl(var(--primary))"
                      style={{ cursor: "nwse-resize" }}
                      onPointerDown={(e) => startResize(e, n)}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 px-2 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[hsl(173_58%_39%/0.5)]" /> Stocked
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-[hsl(24_90%_50%/0.5)]" /> Low stock
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-muted" /> Empty
            </span>
            <span className="ml-auto hidden sm:block">Scroll or use +/− to zoom · drag to pan</span>
          </div>
        </div>

        {/* Edit panel */}
        {editMode && (
          <div className="rounded-xl border border-border bg-card p-4">
            {selected ? (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">Edit node</h3>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Label</span>
                  <input
                    className="h-9 rounded-lg border border-input bg-background px-2 text-foreground outline-none focus:border-primary"
                    value={selected.label}
                    onChange={(e) => updateNode(selected.id, { label: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Kind</span>
                  <select
                    className="h-9 rounded-lg border border-input bg-background px-2 text-foreground outline-none focus:border-primary"
                    value={selected.kind}
                    onChange={(e) => updateNode(selected.id, { kind: e.target.value as MapNode["kind"] })}
                  >
                    <option value="rack">Rack</option>
                    <option value="zone">Zone</option>
                    <option value="door">Door</option>
                    <option value="machine">Machine</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Match rack letter</span>
                  <input
                    maxLength={1}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-foreground outline-none focus:border-primary"
                    value={selected.matchRack ?? ""}
                    onChange={(e) =>
                      updateNode(selected.id, { matchRack: e.target.value.toUpperCase() || undefined })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Match sub-location</span>
                  <input
                    className="h-9 rounded-lg border border-input bg-background px-2 text-foreground outline-none focus:border-primary"
                    value={selected.matchSubLocation ?? ""}
                    onChange={(e) =>
                      updateNode(selected.id, { matchSubLocation: e.target.value || undefined })
                    }
                  />
                </label>
                <button
                  onClick={() => deleteNode(selected.id)}
                  className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-destructive/40 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" /> Delete node
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Click a node to edit it, or add a new one. Drag to move; drag the corner to resize.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Rack contents (view mode: click a node to see what's in it) */}
      <Modal
        open={!!viewNode}
        onClose={() => setViewNode(null)}
        title={viewNode?.label ?? "Rack"}
      >
        {(() => {
          if (!viewNode) return null;
          const matched = active
            ? items.filter((i) => i.area === active.area && nodeMatches(viewNode, i))
            : [];
          const sub = viewNode.matchRack
            ? `Rack ${viewNode.matchRack}`
            : viewNode.matchSubLocation ?? "";
          if (matched.length === 0) {
            return (
              <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
                <Package className="h-8 w-8" />
                <p className="text-sm">Nothing stored here yet{sub ? ` (${sub})` : ""}.</p>
              </div>
            );
          }
          return (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {matched.length} item{matched.length === 1 ? "" : "s"}
                {sub ? ` · ${sub}` : ""}
              </p>
              <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                {matched.map((i) => {
                  const photo = itemPhotos(i)[0];
                  return (
                  <Link
                    key={i.id}
                    href={`/item/${i.id}`}
                    onClick={() => setViewNode(null)}
                    className="flex items-center gap-3 rounded-lg border border-border p-2 transition-colors hover:border-primary"
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                      {photo ? (
                        <img src={photo} alt={i.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Package className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium text-foreground">{i.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{locationString(i)}</span>
                    </span>
                    <span className={cn("text-sm font-semibold", isLowStock(i) ? "text-orange-400" : "text-foreground")}>
                      {i.quantity}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                  );
                })}
              </ul>
            </>
          );
        })()}
      </Modal>

      <FloorDialog
        open={floorDialog.open}
        editing={floorDialog.editing}
        onClose={() => setFloorDialog({ open: false, editing: null })}
        onSaved={(key) => {
          setActiveKey(key);
          setFloorDialog({ open: false, editing: null });
        }}
        onDeleted={() => {
          setActiveKey("");
          setFloorDialog({ open: false, editing: null });
        }}
      />
    </div>
  );
}
