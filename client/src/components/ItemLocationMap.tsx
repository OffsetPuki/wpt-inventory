import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Item, MapLayout, MapNode } from "@shared/schema";
import { MapPin } from "lucide-react";

const VW = 1500;
const VH = 900;

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

// Read-only mini-map that highlights where an item lives on its area's floor plan.
export default function ItemLocationMap({ item }: { item: Item }) {
  const { data: layouts = [] } = useQuery<MapLayout[]>({
    queryKey: ["map-layouts"],
    queryFn: async () => (await apiRequest("GET", "/api/map-layouts")).json(),
  });

  if (!item.area) return null;

  const areaLayouts = layouts.filter((l) => l.area === item.area);
  if (areaLayouts.length === 0) return null;

  // Prefer a floor that actually has a node matching this item; else show the first.
  let layout = areaLayouts[0];
  let matchNode: MapNode | undefined;
  for (const l of areaLayouts) {
    const found = parseNodes(l).find((n) => nodeMatches(n, item));
    if (found) {
      layout = l;
      matchNode = found;
      break;
    }
  }

  const nodes = parseNodes(layout);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
        <MapPin className="h-4 w-4 text-primary" />
        Location · {layout.label}
      </h2>

      <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full rounded-lg bg-background">
        <defs>
          <pattern id="itemMapGridMinor" width={40} height={40} patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(205 90% 60% / 0.16)" strokeWidth={1} />
          </pattern>
          <pattern id="itemMapGrid" width={200} height={200} patternUnits="userSpaceOnUse">
            <rect width={200} height={200} fill="url(#itemMapGridMinor)" />
            <path d="M 200 0 L 0 0 0 200" fill="none" stroke="hsl(205 95% 65% / 0.32)" strokeWidth={1.5} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={VW} height={VH} fill="hsl(210 80% 50% / 0.05)" />
        <rect x={0} y={0} width={VW} height={VH} fill="url(#itemMapGrid)" />

        {nodes.map((n) => {
          const hit = matchNode && n.id === matchNode.id;
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={8}
                fill={hit ? "hsl(var(--primary) / 0.25)" : "hsl(var(--muted))"}
                stroke={hit ? "hsl(var(--primary))" : "hsl(var(--border))"}
                strokeWidth={hit ? 4 : 2}
              />
              <text
                x={n.x + n.w / 2}
                y={n.y + n.h / 2 + 6}
                textAnchor="middle"
                fill={hit ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                fontSize={18}
                fontWeight={hit ? 700 : 500}
              >
                {n.label}
              </text>
            </g>
          );
        })}

        {matchNode && (
          <g>
            <circle cx={matchNode.x + matchNode.w / 2} cy={matchNode.y - 18} r={14} fill="hsl(var(--primary))" />
            <circle cx={matchNode.x + matchNode.w / 2} cy={matchNode.y - 18} r={5} fill="hsl(var(--primary-foreground))" />
          </g>
        )}
      </svg>

      {!matchNode && (
        <p className="mt-2 text-xs text-muted-foreground">
          This item's exact rack isn't placed on the map yet — showing its area floor plan.
        </p>
      )}
    </div>
  );
}
