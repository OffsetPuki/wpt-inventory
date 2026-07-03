import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Search, Loader2 } from "lucide-react";

interface SearchHit {
  type: string;
  label: string;
  sublabel?: string | null;
  href: string;
}

// Global top-bar search. Debounced; results grouped by section; Enter opens
// the first hit, Esc closes. Role scoping happens server-side, so the
// dropdown only ever shows what the signed-in user may open.
export default function SearchBar() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await (await apiRequest("GET", `/api/search?q=${encodeURIComponent(query)}`)).json();
        // Stale responses (an older keystroke resolving late) are dropped.
        if (seq === seqRef.current) {
          setHits(res.results ?? []);
          setLoading(false);
        }
      } catch {
        if (seq === seqRef.current) {
          setHits([]);
          setLoading(false);
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  // Click-away closes the dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setQ("");
    setLocation(hit.href);
  };

  // Group hits by section, preserving server order.
  const groups: { type: string; hits: SearchHit[] }[] = [];
  for (const h of hits) {
    const g = groups.find((x) => x.type === h.type);
    if (g) g.hits.push(h);
    else groups.push({ type: h.type, hits: [h] });
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && hits.length > 0) go(hits[0]);
        }}
        placeholder="Search clients, invoices, items…"
        className="h-10 w-full rounded-full border border-input bg-background pl-10 pr-4 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
      />
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg">
          {loading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No results for “{q.trim()}”</p>
          ) : (
            groups.map((g) => (
              <div key={g.type} className="mb-1 last:mb-0">
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.type}
                </p>
                {g.hits.map((h, i) => (
                  <button
                    key={`${g.type}-${i}`}
                    onClick={() => go(h)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="truncate font-medium text-foreground">{h.label}</span>
                    {h.sublabel && (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">{h.sublabel}</span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
