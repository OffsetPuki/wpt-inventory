import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, MousePointer2, Search, Sparkles } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { inputCls, secondaryBtn } from '@/lib/ui-styles';
import { metric, reportRows, websiteNames, type WebsiteResult } from '@shared/website-analytics';
import { groupMetric, pageAdvice, pagePerformance, publicPage, type GroupValue, type PagePerformance } from '@shared/page-performance';

const colors = ['#0f766e', '#3b82f6', '#d97706', '#8b5cf6', '#db2777', '#64748b'];
const n = (v: number | null) => v === null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
const surface = 'min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5';

function Panel({ title, detail, children, control }: { title: string; detail: string; children: ReactNode; control?: ReactNode }) {
  return <section aria-label={title} className={surface}><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold tracking-tight">{title}</h3><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{detail}</p></div>{control}</div>{children}</section>;
}
function Empty() { return <div className="flex min-h-32 items-center justify-center rounded-xl bg-muted/30 p-5 text-center text-sm text-muted-foreground">No measured values for this selection. Try another period or check Data & connections.</div>; }

type BarValue = { label: string; value: number | null; previous?: number | null; caption?: string; id?: string };
function Bars({ rows, onSelect, selected, color = colors[0] }: { rows: BarValue[]; onSelect?: (row: BarValue) => void; selected?: string; color?: string }) {
  const maximum = Math.max(1, ...rows.flatMap(r => [r.value ?? 0, r.previous ?? 0]));
  if (!rows.length || rows.every(r => r.value === null)) return <Empty/>;
  return <ol className="space-y-3">{rows.map((row, i) => {
    const content = <><div className="mb-2 flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words font-medium">{row.label}</span><span className="shrink-0 font-semibold tabular-nums">{n(row.value)}</span></div><div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(0, (row.value ?? 0) / maximum * 100)}%`, background: color }}/></div>{row.previous !== undefined && <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted/40"><div className="h-full rounded-full bg-slate-400/65" style={{ width: `${(row.previous ?? 0) / maximum * 100}%` }}/></div>}<div className="mt-1.5 flex flex-wrap justify-between gap-1 text-[11px] text-muted-foreground"><span className="min-w-0 break-words">{row.caption}</span>{row.previous !== undefined && <span>Previously {n(row.previous)}</span>}</div></>;
    return <li key={row.id || row.label + i}>{onSelect ? <button aria-pressed={selected === row.id} aria-label={`Inspect ${row.label}${row.caption ? ' · ' + row.caption : ''}`} onClick={() => onSelect(row)} className={'w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ' + (selected === row.id ? 'border-teal-600/50 bg-teal-600/5' : 'border-transparent hover:border-border hover:bg-muted/40')}>{content}</button> : <div className="py-1">{content}</div>}</li>;
  })}</ol>;
}

function Distribution({ title, detail, rows }: { title: string; detail: string; rows: GroupValue[] }) {
  const positive = rows.filter(r => r.value > 0), shown = positive.slice(0, 5);
  if (positive.length > 5) shown.push({ label: 'Other groups', value: positive.slice(5).reduce((sum, r) => sum + r.value, 0) });
  const total = positive.reduce((sum, r) => sum + r.value, 0);
  return <Panel title={title} detail={detail}>{!total ? <Empty/> : <div className="grid items-center gap-5 sm:grid-cols-[160px_1fr]"><div aria-hidden="true" className="relative h-40 w-40 justify-self-center"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={shown} dataKey="value" nameKey="label" innerRadius={52} outerRadius={74} paddingAngle={2} stroke="none" isAnimationActive={false}>{shown.map((r, i) => <Cell key={r.label} fill={colors[i]}/>)}</Pie></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><strong className="text-xl tabular-nums">{n(total)}</strong><span className="text-[10px] text-muted-foreground">reported visits</span></div></div><ul className="space-y-3">{shown.map((r, i) => <li key={r.label} className="flex items-start gap-2 text-xs"><span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i] }}/><span className="min-w-0 flex-1 break-words">{r.label}</span><span className="shrink-0 text-right tabular-nums"><strong>{pct(r.value / total)}</strong><span className="ml-2 text-muted-foreground">{n(r.value)}</span></span></li>)}</ul></div>}</Panel>;
}

export function WebsiteComparison({ sites, onPages }: { sites: WebsiteResult[]; onPages: () => void }) {
  const [measure, setMeasure] = useState('sessions');
  const value = (site: WebsiteResult, period: 'current' | 'previous') => measure === 'sessions' ? metric(site[period].reports.summary?.rows[0], 'sessions') : measure === 'clicks' ? site[period].searchTotals?.clicks ?? null : site[period].totals.leads;
  const rows = sites.map(s => ({ label: websiteNames[s.site], value: value(s, 'current'), previous: value(s, 'previous') })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return <div className="grid min-w-0 gap-4 lg:grid-cols-[1.4fr_1fr]"><Panel title="Compare your websites" detail="Color shows this period; gray shows the preceding period. All bars use the same scale." control={<select aria-label="Website comparison metric" className={inputCls + ' w-auto text-xs'} value={measure} onChange={e => setMeasure(e.target.value)}><option value="sessions">Website visits</option><option value="clicks">Google clicks</option><option value="leads">Saved inquiries</option></select>}><Bars rows={rows}/></Panel><section className="flex flex-col justify-between rounded-2xl border border-teal-600/20 bg-gradient-to-br from-teal-700/10 via-card to-sky-600/5 p-6"><div><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-700 text-white"><MousePointer2 size={21}/></div><p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300">Turn numbers into next steps</p><h3 className="mt-2 text-xl font-semibold tracking-tight">Which pages are working best?</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Compare the pages that attract visits, hold attention and earn search clicks. Select a page to see its strengths and what to review next.</p></div><button onClick={onPages} className={secondaryBtn + ' mt-6 self-start'}>Compare pages <ArrowUpRight size={16}/></button></section></div>;
}

const pageMeasures = { sessions: 'Landing visits', engaged: 'Engaged visits', clicks: 'Google clicks', views: 'Page views' } as const;
type PageMeasure = keyof typeof pageMeasures;
function Change({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null) return <span className="text-muted-foreground">Comparison unavailable</span>;
  const delta = current - previous;
  return <span className="inline-flex items-center gap-1">{delta > 0 ? <ArrowUpRight size={12}/> : delta < 0 ? <ArrowDownRight size={12}/> : null}{delta > 0 ? '+' : ''}{n(delta)} vs {n(previous)} previously</span>;
}

function PageDetail({ page, sites }: { page: PagePerformance; sites: WebsiteResult[] }) {
  const advice = pageAdvice(page);
  const site = sites.find(s => s.site === page.site)!;
  const terms = (site.current.reports.queryPages?.rows || []).filter(r => publicPage(r.page, site.domain) === page.path).sort((a, b) => (metric(b, 'impressions') ?? 0) - (metric(a, 'impressions') ?? 0)).slice(0, 5);
  const facts = [
    { label: 'Landing visits', value: n(page.sessions), note: <Change current={page.sessions} previous={page.previousSessions}/> },
    { label: 'Engagement', value: pct(page.engagement), note: `${n(page.engaged)} engaged visits` },
    { label: 'Google clicks', value: n(page.clicks), note: <Change current={page.clicks} previous={page.previousClicks}/> },
    { label: 'Search appearances', value: n(page.impressions), note: `${pct(page.ctr)} clicked through` },
    { label: 'Average search position', value: page.position === null ? '—' : page.position.toFixed(1), note: 'Lower is better; varies by search' },
    { label: 'Tracked key events', value: n(page.keyEvents), note: 'Actions in sessions starting here; not sales' },
  ];
  return <section aria-label="Selected page analysis" className="min-w-0 rounded-2xl border border-teal-600/25 bg-card p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold text-teal-700 dark:text-teal-300">{page.website} · Selected page</p><h3 className="mt-2 break-all text-lg font-semibold">{page.path}</h3></div><a href={page.url} target="_blank" rel="noopener noreferrer" className={secondaryBtn + ' text-xs'}>Open page <ArrowUpRight size={14}/></a></div><div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-3">{facts.map(f => <div key={f.label} className="min-w-0 rounded-xl bg-muted/40 p-3"><p className="text-[11px] text-muted-foreground">{f.label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{f.value}</p><div className="mt-2 text-[10px] leading-relaxed text-muted-foreground">{f.note}</div></div>)}</div><h4 className="mb-3 mt-6 flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} className="text-amber-600"/>What to review</h4><div className="space-y-3">{advice.map(a => <div key={a.title} className={'rounded-xl border-l-2 p-3 ' + (a.tone === 'amber' ? 'border-amber-500 bg-amber-500/5' : a.tone === 'teal' ? 'border-teal-600 bg-teal-600/5' : 'border-blue-500 bg-blue-500/5')}><p className="text-xs font-semibold">{a.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.body}</p></div>)}</div><h4 className="mb-3 mt-6 text-sm font-semibold">Searches showing this page</h4>{terms.length ? <ul className="space-y-2">{terms.map((r, i) => <li key={i} className="flex flex-wrap justify-between gap-2 border-b border-border/60 pb-2 text-xs"><span className="min-w-0 break-words">{String(r.query)}</span><span className="text-muted-foreground">{n(metric(r, 'impressions'))} appearances · {n(metric(r, 'clicks'))} clicks</span></li>)}</ul> : <p className="text-xs text-muted-foreground">No query-to-page rows reported for this page and period.</p>}</section>;
}

export function PageExplorer({ sites }: { sites: WebsiteResult[] }) {
  const [measure, setMeasure] = useState<PageMeasure>('sessions'), [filter, setFilter] = useState(''), [selected, setSelected] = useState('');
  const pages = useMemo(() => pagePerformance(sites), [sites]);
  const filtered = useMemo(() => pages.filter(p => `${p.website} ${p.path}`.toLowerCase().includes(filter.toLowerCase())), [pages, filter]);
  const ranked = useMemo(() => [...filtered].filter(p => p[measure] !== null).sort((a, b) => (b[measure] ?? 0) - (a[measure] ?? 0) || a.id.localeCompare(b.id)), [filtered, measure]);
  const page = filtered.find(p => p.id === selected) || ranked[0] || filtered[0];
  const mostVisited = [...pages].filter(p => (p.sessions ?? 0) > 0).sort((a, b) => b.sessions! - a.sessions!)[0];
  const engaging = [...pages].filter(p => (p.sessions ?? 0) >= 20 && p.engagement !== null).sort((a, b) => b.engagement! - a.engagement!)[0];
  const opportunity = [...pages].filter(p => (p.impressions ?? 0) >= 50 && p.ctr !== null && p.ctr < .02 && p.position !== null && p.position <= 20).sort((a, b) => b.impressions! - a.impressions!)[0];
  const highlights = [
    { label: 'Most visited landing page', page: mostVisited, metric: mostVisited ? `${n(mostVisited.sessions)} visits` : 'No measured visits', detail: 'Where the most sessions begin.', color: 'text-teal-700 dark:text-teal-300' },
    { label: 'Strongest engagement', page: engaging, metric: engaging ? `${pct(engaging.engagement)} engaged` : 'Not enough data yet', detail: 'Highest rate among pages with 20+ visits.', color: 'text-blue-700 dark:text-blue-300' },
    { label: 'Search opportunity', page: opportunity, metric: opportunity ? `${n(opportunity.impressions)} appearances` : 'No priority flagged', detail: 'Visible in search, but fewer than 2% click.', color: 'text-amber-700 dark:text-amber-300' },
  ];
  const inspect = (p: PagePerformance) => { setFilter(''); setSelected(p.id); };
  const plotted = [...filtered].filter(p => p.sessions !== null && p.sessions > 0 && p.engagement !== null).sort((a, b) => b.sessions! - a.sessions!).slice(0, 50).map(p => ({ ...p, engagementPercent: p.engagement! * 100 }));
  return <>
    <section aria-label="Page highlights" className="grid gap-3 lg:grid-cols-3">{highlights.map(h => <button disabled={!h.page} key={h.label} onClick={() => h.page && inspect(h.page)} className="min-w-0 rounded-2xl border bg-card p-5 text-left transition-colors hover:border-teal-600/40 disabled:cursor-default disabled:hover:border-border"><p className={'text-xs font-semibold ' + h.color}>{h.label}</p><p className="mt-3 text-xl font-semibold tracking-tight">{h.metric}</p>{h.page && <><p className="mt-2 truncate text-sm font-medium" title={h.page.path}>{h.page.path}</p><p className="mt-1 text-[11px] text-muted-foreground">{h.page.website} · Click to inspect</p></>}<p className="mt-3 text-xs leading-relaxed text-muted-foreground">{h.detail}</p></button>)}</section>
    <div className="rounded-2xl border bg-muted/20 p-4 text-sm leading-relaxed"><strong>Choose what “better” means.</strong> Visits measure reach, engagement shows attention, and search clicks show visibility turning into visits. No single metric proves a page generates sales.</div>
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[.9fr_1.1fr]">
      <Panel title="Page performance explorer" detail="Select a bar to inspect the page. Teal shows this period; gray shows the previous period where available.">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1"><label className="text-xs font-medium">Compare by<select aria-label="Page ranking metric" value={measure} onChange={e => { setMeasure(e.target.value as PageMeasure); setSelected(''); }} className={inputCls + ' mt-1 text-sm'}>{Object.entries(pageMeasures).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs font-medium">Find a page<div className="relative mt-1"><Search size={14} className="absolute left-3 top-3.5 text-muted-foreground"/><input aria-label="Find a page to compare" value={filter} onChange={e => { setFilter(e.target.value); setSelected(''); }} placeholder="Page address or business…" className={inputCls + ' pl-9 text-sm'}/></div></label></div>
        <Bars rows={ranked.slice(0, 8).map(p => ({ id: p.id, label: p.path, caption: p.website, value: p[measure], previous: measure === 'sessions' ? p.previousSessions : measure === 'clicks' ? p.previousClicks : undefined }))} selected={page?.id} onSelect={r => setSelected(r.id!)}/><p className="mt-4 text-[11px] text-muted-foreground">Top {Math.min(8, ranked.length)} of {ranked.length} matching pages with reported {pageMeasures[measure].toLowerCase()}. Use the detailed tables below to see and export every row.</p>
      </Panel>
      {page ? <PageDetail page={page} sites={sites}/> : <Panel title="Selected page analysis" detail="Select a page to review its results."><Empty/></Panel>}
    </div>
    <Panel title="Visits and attention" detail="Each dot is a landing page. Farther right means more visits; higher means a larger share engaged. Up to 50 pages with the most visits in your page filter. Hover or tap a dot for the page.">
      {plotted.length ? <div role="img" aria-label="Scatter plot of landing visits versus engagement rate. The page explorer and landing-page table provide the same metrics in text." className="h-72 min-w-0"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 15, bottom: 25, left: 0, right: 15 }}><CartesianGrid stroke="currentColor" opacity={.08}/><XAxis type="number" dataKey="sessions" name="Visits" fontSize={11} allowDecimals={false} label={{ value: 'Landing visits →', position: 'bottom', offset: 5, fontSize: 11 }}/><YAxis type="number" dataKey="engagementPercent" name="Engagement" unit="%" domain={[0, 100]} width={47} fontSize={11}/><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => { const p = payload?.[0]?.payload; return active && p ? <div className="max-w-64 rounded-xl border bg-popover p-3 text-xs shadow-lg"><p className="break-all font-semibold">{p.path}</p><p className="mt-1 text-muted-foreground">{p.website}</p><p className="mt-2">{n(p.sessions)} visits · {pct(p.engagement)} engaged</p></div> : null; }}/><Scatter data={plotted} fill={colors[0]} fillOpacity={.7} isAnimationActive={false}/></ScatterChart></ResponsiveContainer></div> : <Empty/>}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Small samples move easily. Suggestions use 20+ landing visits for engagement, or 50+ search appearances with average position 20 or better for low click-through. They are review prompts, not diagnoses. Redacted/private paths are excluded; missing reports stay unavailable.</p>
    </Panel>
  </>;
}

export function SearchVisuals({ sites }: { sites: WebsiteResult[] }) {
  const queries = reportRows(sites, 'queries');
  const clicks = queries.filter(r => (metric(r, 'clicks') ?? 0) > 0).sort((a, b) => Number(b.clicks) - Number(a.clicks)).slice(0, 6);
  const opportunities = queries.filter(r => (metric(r, 'impressions') ?? 0) >= 50 && metric(r, 'position') !== null && Number(r.position) >= 8 && Number(r.position) <= 20).sort((a, b) => Number(b.impressions) - Number(a.impressions)).slice(0, 6);
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Panel title="Searches bringing visitors" detail="Your six leading reported Google searches by clicks. Private or withheld searches are not included."><Bars rows={clicks.map(r => ({ label: String(r.query), value: metric(r, 'clicks'), caption: `${r.website} · clicks` }))}/></Panel><Panel title="Search terms to work on" detail="50+ appearances and average position 8–20. Review the matching page, improve its answer and connect it to related pages."><Bars color={colors[2]} rows={opportunities.map(r => ({ label: String(r.query), value: metric(r, 'impressions'), caption: `${r.website} · appearances · position ${Number(r.position).toFixed(1)}` }))}/></Panel></div>;
}

export function TrafficVisuals({ sites }: { sites: WebsiteResult[] }) {
  const channels = reportRows(sites, 'channels');
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Distribution title="Where visits come from" detail="Share of reported channel visits. Organic Search is unpaid search; Direct has no identified source. This is not inquiry attribution." rows={groupMetric(channels, 'sessionDefaultChannelGroup', 'sessions')}/><Panel title="Channels that hold attention" detail="Engaged visits by channel. More visits and stronger engagement can both increase this number."><Bars rows={groupMetric(channels, 'sessionDefaultChannelGroup', 'engagedSessions').slice(0, 6).map(r => ({ ...r, caption: 'engaged visits' }))} color={colors[1]}/></Panel></div>;
}

export function AudienceVisuals({ sites }: { sites: WebsiteResult[] }) {
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Distribution title="Screens your visitors use" detail="Share of reported device/browser visits. A high mobile share is a reason to check your pages on a phone. Breakdown totals can differ from summary visits." rows={groupMetric(reportRows(sites, 'devices'), 'deviceCategory', 'sessions')}/><Panel title="Top visitor countries" detail="Six leading reported countries by visits. Location is approximate and can be affected by VPNs and privacy settings."><Bars rows={groupMetric(reportRows(sites, 'locations'), 'country', 'sessions').slice(0, 6)} color={colors[1]}/></Panel></div>;
}

export function OutcomeVisuals({ sites }: { sites: WebsiteResult[] }) {
  const rows = sites.flatMap(s => s.current.bySource), leads = sites.reduce((v, s) => v + s.current.totals.leads, 0);
  const quoted = sites.reduce((v, s) => v + s.current.totals.quoted, 0), won = sites.reduce((v, s) => v + s.current.totals.won, 0);
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2"><Panel title="From inquiry to recorded results" detail="Outcomes to date for inquiries received in your selected period. Categories can overlap; these are not visitor-funnel steps."><Bars rows={[{ label: 'Inquiries received', value: leads }, { label: 'Inquiries with a quote', value: quoted }, { label: 'Inquiries won', value: won }]} color={colors[1]}/><div className="mt-5 flex items-center gap-2 rounded-xl bg-teal-600/5 p-3 text-xs"><CheckCircle2 size={16} className="shrink-0 text-teal-700"/>{leads > 0 ? `${pct(won / leads)} of this inquiry group has a recorded win.` : 'No inquiries recorded in this period.'}</div></Panel><Panel title="Sources bringing inquiries" detail="Top six recorded first-touch sources. Unknown attribution stays unknown; these counts are separate from Analytics visits."><Bars rows={groupMetric(rows, 'source', 'leads').slice(0, 6)} color={colors[2]}/></Panel></div>;
}
