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
  const [active,setActive]=useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,setError]=useState("");
  const [expanded,setExpanded]=useState(false);
  const [more,setMore]=useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setError("");
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await (await apiRequest("GET", `/api/search?q=${encodeURIComponent(query)}${expanded?"&all=1":""}`, undefined, {signal:controller.signal})).json();
        // Stale responses (an older keystroke resolving late) are dropped.
        if (seq === seqRef.current) {
          setHits(res.results ?? []);
          setMore(!!res.more);
          if(res.unavailable?.length)setError(`Some sections are unavailable: ${res.unavailable.join(", ")}`);
          setLoading(false);
        }
      } catch {
        if (seq === seqRef.current) {
          setHits([]);
          setError("Search unavailable. Try again.");
          setLoading(false);
        }
      }
    }, 250);
    return () => {clearTimeout(t);controller.abort();};
  }, [q,expanded]);

  // Click-away closes the dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (hit: SearchHit) => {
    // Nothing unmounts this input on navigation (it lives in the persistent
    // shell header), so without this the soft keyboard stays up over the page
    // the user just opened.
    (document.activeElement as HTMLElement | null)?.blur();
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
          setQ(e.target.value);setExpanded(false);setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          // !loading, or the phone keyboard's Go opens the hit for the query
          // BEFORE the one just typed — hits still holds the old results for the
          // 250ms debounce plus the round trip, while the panel shows a spinner.
          const ordered=groups.flatMap(g=>g.hits);
          if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,ordered.length-1));}
          if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(0,i-1));}
          if (e.key === "Enter" && !loading && ordered.length > 0) {e.preventDefault();go(ordered[Math.max(0,Math.min(active,ordered.length-1))]);}
        }}
        placeholder="Search clients, invoices, items…"
        className="h-10 w-full rounded-full border border-input bg-background pl-10 pr-4 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
      />
      {/* On a phone the input only gets the slice of the topbar left over
          after the menu, logo and theme toggle — about 210px — which truncates
          every result to the same unreadable stub. The panel breaks out to full
          width there. 4.25rem is the mobile topbar: py-3 twice plus a 44px
          control. From lg: up the desktop topbar takes over and the panel
          anchors back to the input. */}
      {open && q.trim().length >= 2 && (
        <div className="fixed inset-x-3 top-[4.25rem] z-50 max-h-[40vh] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 shadow-lg lg:absolute lg:inset-x-auto lg:left-0 lg:right-0 lg:top-full lg:mt-2 lg:max-h-96">
          {error && <p role="alert" className="px-3 py-2 text-destructive">{error}</p>}
          {loading ? (
            <div className="flex justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : hits.length === 0 ? (
            !error&&<p className="px-3 py-3 text-sm text-muted-foreground">No results for “{q.trim()}”</p>
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
                    onMouseEnter={()=>setActive(groups.flatMap(g=>g.hits).indexOf(h))}
                    aria-current={groups.flatMap(g=>g.hits).indexOf(h)===active?"true":undefined}
                    style={groups.flatMap(g=>g.hits).indexOf(h)===active?{backgroundColor:"hsl(var(--accent))"}:undefined}
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
          {more&&!expanded&&<button className="px-3 py-3 underline" onClick={()=>setExpanded(true)}>More matches</button>}
        </div>
      )}
    </div>
  );
}
