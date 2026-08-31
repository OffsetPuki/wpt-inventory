// =============================================================================
//  Quote builder — the standalone CJM Quote app, embedded in the suite.
//
//  What changed from the .exe version:
//    · Price book + shop identity live in the suite DB (/api/quotes/settings),
//      shared by every device. Edits save back automatically (debounced).
//    · Quotes auto-save to the suite (/api/quotes) when you reach the details
//      step — the quote number is assigned by the server, and the Saved view
//      lists every quote from any device.
//    · "Find design" reads the suite's own web_designs table (no URL/key).
//  Everything else — pricing math, configurators, previews, the printable
//  quote — is the original code, untouched.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/components/ui/toaster';

import { defaultState } from './data/configurators.js';
import { DEFAULT_PRICE_BOOK } from './data/priceBook.js';
import { buildLineState, deriveWarnings, materialTotals } from './lib/estimate.js';
import { fetchLeads } from './lib/leads.js';
import { parseLead } from './lib/designSpec.js';
import { computeTotals } from './lib/quote.js';
import {
  deepMerge, DEFAULT_SHOP, duplicateSession, loadSession, saveSession, setPath,
} from './lib/store.js';

import Home from './components/Home.jsx';
import Configurator from './components/Configurator.jsx';
import QuoteForm from './components/QuoteForm.jsx';
import PriceBookPanel from './components/PriceBookPanel.jsx';
import FindDesign from './components/FindDesign.jsx';
import SavedQuotes from './components/SavedQuotes.jsx';
import Costing from './components/Costing.jsx';

// Client-side session identity — correlates async save responses with the
// session that started them, so a slow POST can't stamp its quoteId/number
// onto a different quote the user has since switched to.
function newSid() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random()}`; }
}

function newSession(type, priceBook) {
  return {
    sid: newSid(),
    type,
    state: defaultState(type),
    overrides: {},
    materialMarkupPct: priceBook.materialMarkupPct,
    laborMarkupPct: priceBook.laborMarkupPct,
    taxPct: priceBook.taxPct,
    deliveryMiles: 0,
    deliveryPerMile: priceBook.deliveryPerMile,
    customer: { name: '', company: '', phone: '', email: '', location: '' },
    notes: '',
    depositPct: 0,
    // What we built in — one design feature per line, printed as bullets.
    features: '',
    // Simulation renders / shop drawings shown to the customer ({url, caption}).
    attachments: [],
    discountPct: 0,
    // Rate versioning: a NEW quote prices live off the current book. Saving
    // stamps a snapshot of the book into the payload; a REOPENED quote prices
    // off its snapshot so old quotes never move when rates change — unless the
    // owner explicitly unlocks it ("Use today's rates").
    priceBookSnapshot: null,
    priceBookSnapshotAt: null,
    // number + quoteId are assigned by the server the first time the quote
    // saves (on reaching the details step) — see saveQuote below.
    number: null,
    quoteId: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Backfill fields added after a session was first saved, so an in-progress quote
 * from an older version keeps working. The old single `markupPct` seeds both new
 * markup rates (preserving the previous total).
 */
function migrateSession(sess, priceBook) {
  if (!sess) return sess;
  const legacy = sess.markupPct;
  return {
    ...sess,
    materialMarkupPct: sess.materialMarkupPct ?? legacy ?? priceBook.materialMarkupPct,
    laborMarkupPct: sess.laborMarkupPct ?? legacy ?? priceBook.laborMarkupPct,
    taxPct: sess.taxPct ?? priceBook.taxPct,
    deliveryMiles: sess.deliveryMiles ?? 0,
    deliveryPerMile: sess.deliveryPerMile ?? priceBook.deliveryPerMile,
    discountPct: sess.discountPct ?? 0,
    priceBookSnapshot: sess.priceBookSnapshot ?? null,
    priceBookSnapshotAt: sess.priceBookSnapshotAt ?? null,
    features: typeof sess.features === 'string' ? sess.features : '',
    attachments: Array.isArray(sess.attachments) ? sess.attachments : [],
    quoteId: sess.quoteId ?? null,
    sid: sess.sid ?? newSid(),
  };
}

export default function QuoteBuilder({ initialSettings }) {
  const qc = useQueryClient();

  // Writing the SHARED price book is owner-only — the rates here price every
  // future quote and every instant estimate on the public website, and this
  // panel auto-saves 800ms after a keystroke with no save button to think
  // twice at. The server enforces it; this flag stops a worker typing into a
  // field whose save would be silently discarded. Absent (older server build)
  // means allowed, so client and server can deploy in either order.
  const canEditRates = initialSettings?.canEditRates !== false;

  const [priceBook, setPriceBook] = useState(() =>
    deepMerge(DEFAULT_PRICE_BOOK, initialSettings?.priceBook || {}));
  const [shop, setShop] = useState(() =>
    deepMerge(DEFAULT_SHOP, initialSettings?.shop || {}));
  const [session, setSession] = useState(() =>
    migrateSession(loadSession(), deepMerge(DEFAULT_PRICE_BOOK, initialSettings?.priceBook || {})));
  const [view, setView] = useState(() => (loadSession() ? 'configure' : 'home'));

  // ── Persistence ────────────────────────────────────────────────────────────
  // The in-progress session stays in localStorage (same key as the old app) —
  // it's a scratchpad. Rates + shop identity save to the suite, debounced so
  // dragging a slider in the price book doesn't fire a request per tick.
  useEffect(() => { if (session) saveSession(session); }, [session]);

  // settingsDirty is set only by the explicit edit paths (updatePriceBook /
  // updateShop / resetPriceBook) — not by an effect watching state — so a
  // StrictMode double-mount or remount never writes untouched settings back.
  const settingsDirty = useRef(false);
  const latestSettings = useRef({ priceBook, shop });
  useEffect(() => { latestSettings.current = { priceBook, shop }; }, [priceBook, shop]);

  const putSettings = (body) =>
    apiRequest('PUT', '/api/quotes/settings', body).catch((e) => {
      settingsDirty.current = true; // keep it dirty so a later edit/flush retries
      toast({ variant: 'destructive', title: 'Rates not saved', description: e?.message });
    });

  useEffect(() => {
    if (!settingsDirty.current) return;
    if (!canEditRates) { settingsDirty.current = false; return; } // server would discard it
    // Mirror local state into the query cache right away so a remount within
    // the cache's staleTime (navigate away and back) can't revert the edits.
    qc.setQueryData(['quote-settings'], { priceBook, shop });
    const t = setTimeout(() => {
      settingsDirty.current = false;
      putSettings({ priceBook, shop });
    }, 800);
    return () => clearTimeout(t);
  }, [priceBook, shop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on unmount: leaving the page inside the debounce window must not
  // drop the last edit (the old app wrote localStorage synchronously; the
  // server-backed version needs this explicit goodbye write).
  useEffect(() => () => {
    if (settingsDirty.current) {
      settingsDirty.current = false;
      qc.setQueryData(['quote-settings'], latestSettings.current);
      putSettings(latestSettings.current);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The suite shell (sidebar, padding) steps aside for this page: qa-page
  // removes the content padding. (The printable document itself lives on the
  // website — cjmmetals.com/quote/<token> — so there is no in-app print view.)
  useEffect(() => {
    document.body.classList.add('qa-page');
    return () => { document.body.classList.remove('qa-page'); };
  }, []);

  // ── Auto-save to the suite ──────────────────────────────────────────────────
  // First save (entering details) creates the row and brings back the server-
  // assigned number; later transitions update the same row.
  const resaveQueued = useRef(false);
  const persistQuoteRef = useRef(() => {});
  // Mirrors saveQuote.isPending in a ref: an async caller (Preview) that awaits
  // must read the CURRENT state, not the value its render closed over.
  const savingRef = useRef(false);
  // Same reason for the saved row's id: it only exists after the first POST
  // returns, which is exactly what Preview waits for.
  const persistedIdRef = useRef(null);
  const saveQuote = useMutation({
    onMutate: () => { savingRef.current = true; },
    mutationFn: async ({ sess, totalCents }) => {
      const body = {
        type: sess.type,
        customerName: sess.customer?.name || null,
        designRef: sess.designRef || null,
        totalCents,
        payload: sess,
      };
      const res = sess.quoteId
        ? await apiRequest('PATCH', `/api/quotes/${sess.quoteId}`, body)
        : await apiRequest('POST', '/api/quotes', body);
      return res.json();
    },
    onSuccess: (row, { sess }) => {
      // Only stamp the response onto the session that started this save — the
      // user may have opened a different quote while the request was in flight.
      setSession((s) => {
        if (!s || s.sid !== sess.sid) return s;
        persistedIdRef.current = row.id;
        return { ...s, quoteId: row.id, number: row.number };
      });
      qc.invalidateQueries({ queryKey: ['quotes'] });
    },
    onError: (e, { sess }) => {
      const msg = String(e?.message || '');
      // The row was deleted from the Saved list while this session pointed at
      // it — forget the stale id so the next save creates a fresh quote.
      if (msg.toLowerCase().includes('not found')) {
        setSession((s) => (s && s.sid === sess.sid ? { ...s, quoteId: null } : s));
      }
      toast({ variant: 'destructive', title: 'Quote not saved', description: msg || 'Could not reach the suite.' });
    },
    onSettled: () => {
      savingRef.current = false;
      // A transition that arrived while this save was in flight was skipped by
      // the isPending guard — replay it once so the row never misses the last
      // step's data (e.g. customer details entered during a slow first POST).
      if (resaveQueued.current) {
        resaveQueued.current = false;
        persistQuoteRef.current();
      }
    },
  });

  // ── Derived pricing — only meaningful when a session exists ────────────────
  // A reopened quote carries a snapshot of the price book from when it was
  // saved; it prices against THAT book (old quotes don't move when rates
  // change). New/unlocked quotes price against the live book.
  const effectiveBook = useMemo(
    () => (session?.priceBookSnapshot
      ? deepMerge(DEFAULT_PRICE_BOOK, session.priceBookSnapshot)
      : priceBook),
    [session?.priceBookSnapshot, priceBook],
  );
  const lineState = useMemo(
    () => (session ? buildLineState(session.type, session.state, effectiveBook, session.overrides) : null),
    [session, effectiveBook],
  );
  const totals = useMemo(
    () => (lineState ? computeTotals(lineState, {
      materialMarkupPct: session.materialMarkupPct,
      laborMarkupPct: session.laborMarkupPct,
      taxPct: session.taxPct,
      deliveryMiles: session.deliveryMiles,
      deliveryPerMile: session.deliveryPerMile,
      discountPct: session.discountPct,
      minJobCharge: effectiveBook.minJobCharge,
    }) : null),
    [lineState, session, effectiveBook],
  );
  // "Did you forget?" checklist + the per-material purchase totals (cut list).
  const warnings = useMemo(
    () => (session && lineState ? deriveWarnings(session.type, session.state, lineState, {
      materialMarkupPct: session.materialMarkupPct,
      laborMarkupPct: session.laborMarkupPct,
      taxPct: session.taxPct,
      deliveryMiles: session.deliveryMiles,
      discountPct: session.discountPct,
    }) : []),
    [session, lineState],
  );
  const materialsSummary = useMemo(
    () => (lineState ? materialTotals(lineState.items, effectiveBook) : []),
    [lineState, effectiveBook],
  );

  // Keep the id mirror in step with the session (reopening a saved quote,
  // starting a new one). onSuccess also stamps it, for the await-ing caller.
  persistedIdRef.current = session?.quoteId ?? null;

  const persistQuote = () => {
    if (!session) return;
    // One save in flight at a time — a quick configure → details → print run
    // must not fire a second POST before the first returns the quote id. The
    // skipped save is queued and replayed from onSettled.
    if (savingRef.current) { resaveQueued.current = true; return; }
    // Stamp the book this quote was priced with into the payload (rate
    // versioning). A locked quote keeps its own snapshot; a live one freezes
    // the current book as of this save.
    const sess = {
      ...session,
      priceBookSnapshot: session.priceBookSnapshot || priceBook,
      priceBookSnapshotAt: session.priceBookSnapshot
        ? (session.priceBookSnapshotAt || session.createdAt)
        : new Date().toISOString(),
    };
    saveQuote.mutate({ sess, totalCents: Math.round((totals?.total ?? 0) * 100) });
  };
  persistQuoteRef.current = persistQuote;

  // The customer's page on cjmmetals.com is the ONE rendering of the quote
  // document (print/PDF included). Preview mints the share token WITHOUT the
  // send side effects (?preview=1 lets the site show a still-draft quote);
  // actually sending it stays in the Share panel.
  const openCustomerPage = async () => {
    persistQuote();
    // The page renders from the STORED payload, so the save (and any replay it
    // queued behind an in-flight one) has to land first — otherwise Preview
    // shows the quote as it was one edit ago.
    for (let i = 0; savingRef.current && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100)); // ponytail: 10s cap, then show what we have
    }
    const id = persistedIdRef.current;
    if (!id) {
      toast({ title: 'Saving the quote…', description: 'One second — try Preview again once the quote number appears.' });
      return;
    }
    try {
      const res = await (await apiRequest('POST', `/api/quotes/${id}/share`, { preview: true })).json();
      window.open(res.url, '_blank', 'noopener');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not open the preview', description: e?.message });
    }
  };

  // ── Session mutators ────────────────────────────────────────────────────────
  const patchSession = (patch) => setSession((s) => ({ ...s, ...patch }));
  const setStateField = (name, value) =>
    setSession((s) => ({ ...s, state: { ...s.state, [name]: value } }));

  const editItem = (key, field, value) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      items[key] = { ...(items[key] || {}), [field]: value };
      return { ...s, overrides: { ...s.overrides, items } };
    });
  const editLabor = (field, value) =>
    setSession((s) => ({ ...s, overrides: { ...s.overrides, labor: { ...(s.overrides.labor || {}), [field]: value } } }));
  const editInstall = (field, value) =>
    setSession((s) => ({ ...s, overrides: { ...s.overrides, install: { ...(s.overrides.install || {}), [field]: value } } }));
  const resetOverrides = () => setSession((s) => ({ ...s, overrides: {} }));

  // Custom lines live in overrides (flagged `custom`) so they survive option
  // changes and reprice-resets are explicit.
  // spec = { name, kind, rate, materialId?, unit? } from the add-line form.
  const addCustomLine = (spec) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      items[`custom_${Date.now()}`] = {
        custom: true, name: 'Custom line', kind: 'flat', qty: 1, rate: 0, ...spec,
      };
      return { ...s, overrides: { ...s.overrides, items } };
    });
  const removeCustomLine = (key) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      delete items[key];
      return { ...s, overrides: { ...s.overrides, items } };
    });

  // Strike a derived line off this quote (or put it back). Custom lines are
  // deleted outright above — you typed them, so removing means gone; a derived
  // line is regenerated from the design every time, so it needs a flag.
  const setLineRemoved = (key, removed) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      const next = { ...(items[key] || {}) };
      if (removed) next.removed = true;
      else delete next.removed;
      // An override that no longer says anything is just noise — drop it, so
      // "Reset to price book" stays an honest signal of real edits.
      if (Object.keys(next).length === 0) delete items[key];
      else items[key] = next;
      return { ...s, overrides: { ...s.overrides, items } };
    });

  // Move a line one place up (-1) or down (+1). The order is stored as a list
  // of item keys in the overrides, seeded from the order you're looking at when
  // you click — so it survives option changes exactly like a rename does, and
  // lines the design adds later fall in at the end.
  const moveLine = (key, dir) =>
    setSession((s) => {
      const keys = (lineState?.items || []).map((it) => it.key);
      const i = keys.indexOf(key);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= keys.length) return s;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      return { ...s, overrides: { ...s.overrides, order: keys } };
    });

  // Unlock a snapshot-priced quote so it reprices with today's book (the next
  // save freezes today's book in as the new snapshot).
  const unlockPrices = () =>
    setSession((s) => ({ ...s, priceBookSnapshot: null, priceBookSnapshotAt: null }));
  const setCustomer = (field, value) =>
    setSession((s) => ({ ...s, customer: { ...s.customer, [field]: value } }));

  // ── Navigation ──────────────────────────────────────────────────────────────
  // Customer waiting to be stamped onto the next new quote — set by the
  // "Quote this lead" handoff below when the lead has no website design.
  const pendingCustomer = useRef(null);
  const startConfig = (type) => {
    const sess = newSession(type, priceBook);
    if (pendingCustomer.current) {
      sess.customer = { ...sess.customer, ...pendingCustomer.current };
      pendingCustomer.current = null;
    }
    setSession(sess);
    setView('configure');
  };
  const goHome = () => setView('home');

  // A looked-up website design becomes a quote: the customer's options overlay
  // the defaults, their contact info fills the customer card, and the design
  // code rides along onto the recap + PDF.
  const startFromLead = (lead, parsed) => {
    const sess = newSession(parsed.type, priceBook);
    sess.state = { ...sess.state, ...parsed.state };
    sess.customer = {
      name: lead.name || '',
      company: '',
      phone: lead.phone || '',
      email: lead.email || '',
      location: lead.location || '',
    };
    sess.designRef = lead.ref || '';
    // A trades-planner lead carries its multi-trade scope as prose — parseLead
    // hands it back as `notes` so the plan lands on the quote screen.
    if (parsed.notes) sess.notes = parsed.notes;
    setSession(sess);
    setView('configure');
  };

  // "Quote this lead" handoff from the CRM (pages/crm/leads.tsx): the lead
  // modal stores { name, phone, email, designRef } under this key and
  // navigates here. With a designRef we run the same design-import path Find
  // design uses (startFromLead), so the configurator state loads too; without
  // one the customer waits in pendingCustomer for the next "New quote" pick.
  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem('cjm.quote.prefillLead');
      if (raw != null) sessionStorage.removeItem('cjm.quote.prefillLead');
    } catch { /* storage unavailable */ }
    if (!raw) return;
    let lead;
    try { lead = JSON.parse(raw); } catch { return; }
    const customer = {
      name: lead.name || '', company: '', phone: lead.phone || '',
      email: lead.email || '', location: '',
    };
    pendingCustomer.current = customer;
    setView('home');
    if (!lead.designRef) return;
    fetchLeads({ ref: lead.designRef })
      .then((rows) => {
        const row = rows.find((r) => parseLead(r));
        if (!row) return; // design not found — plain customer prefill stays pending
        pendingCustomer.current = null;
        startFromLead({
          ...row,
          name: row.name || customer.name,
          phone: row.phone || customer.phone,
          email: row.email || customer.email,
        }, parseLead(row));
      })
      .catch(() => { /* lookup failed — plain customer prefill stays pending */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reopen a saved quote from the suite — edits keep saving to the same number.
  const openSaved = (sess) => {
    setSession(migrateSession(sess, priceBook));
    setView('configure');
  };

  // Start a NEW quote from a saved one — the second grill, the next fence on
  // the same street. It has no number until it reaches the details step, so
  // nothing can write back over the quote it was copied from.
  const duplicateSaved = (sess) => {
    setSession(duplicateSession(migrateSession(sess, priceBook), newSid()));
    setView('configure');
    toast({
      title: 'Copy started',
      description: 'Lines and rates came along; the customer is blank and it gets its own number when you reach the details step.',
    });
  };

  // ── Price book ──────────────────────────────────────────────────────────────
  // Editing a material's COST also stamps materials.<id>.updatedAt — that
  // feeds the staleness badges here and the hourly "review material prices"
  // sweep on the server (automations.ts).
  const updatePriceBook = (path, value) => {
    settingsDirty.current = true;
    setPriceBook((pb) => {
      let next = setPath(pb, path, value);
      const m = /^materials\.([^.]+)\.cost$/.exec(path);
      if (m) next = setPath(next, `materials.${m[1]}.updatedAt`, Date.now());
      return next;
    });
  };
  // Dot-paths ('bank.routing') go through setPath — a flat spread would create
  // a literal "bank.routing" key and the nested value would never be read back.
  const updateShop = (field, value) => {
    settingsDirty.current = true;
    setShop((sh) => (field.includes('.') ? setPath(sh, field, value) : { ...sh, [field]: value }));
  };
  const resetPriceBook = () => {
    if (window.confirm('Reset all rates to the defaults?')) {
      settingsDirty.current = true;
      setPriceBook({ ...DEFAULT_PRICE_BOOK });
    }
  };

  const inQuoteFlow = view === 'home' || view === 'configure' || view === 'details';

  // Guard: flow views need a session.
  const activeView = (inQuoteFlow && view !== 'home' && !session) ? 'home' : view;

  return (
    <div className="qa">
      <div className="app">
        <header className="topbar no-print">
          <nav className="topnav">
            <button className={inQuoteFlow ? 'active' : ''} onClick={goHome}>New quote</button>
            <button className={view === 'find' ? 'active' : ''} onClick={() => setView('find')}>Find design</button>
            <button className={view === 'saved' ? 'active' : ''} onClick={() => setView('saved')}>Saved</button>
            <button className={view === 'costing' ? 'active' : ''} onClick={() => setView('costing')}>Costing</button>
            <button className={view === 'pricebook' ? 'active' : ''} onClick={() => setView('pricebook')}>Price book</button>
          </nav>
        </header>

        {activeView === 'home' && <Home onPick={startConfig} onFind={() => setView('find')} />}

        {activeView === 'find' && (
          <FindDesign onStartQuote={startFromLead} />
        )}

        {activeView === 'saved' && (
          <SavedQuotes onOpen={openSaved} onDuplicate={duplicateSaved} />
        )}

        {activeView === 'costing' && (
          <Costing priceBook={priceBook} onChangePriceBook={updatePriceBook} />
        )}

        {activeView === 'configure' && session && (
          <Configurator
            type={session.type}
            state={session.state}
            lineState={lineState}
            totals={totals}
            warnings={warnings}
            materialsSummary={materialsSummary}
            priceLockAt={session.priceBookSnapshot ? (session.priceBookSnapshotAt || session.createdAt) : null}
            priceBook={effectiveBook}
            materialMarkupPct={session.materialMarkupPct}
            laborMarkupPct={session.laborMarkupPct}
            taxPct={session.taxPct}
            discountPct={session.discountPct}
            deliveryMiles={session.deliveryMiles}
            deliveryRate={session.deliveryPerMile}
            onChangeOption={setStateField}
            onEditItem={editItem}
            onEditLabor={editLabor}
            onEditInstall={editInstall}
            onAddCustomLine={addCustomLine}
            onRemoveCustomLine={removeCustomLine}
            onSetLineRemoved={setLineRemoved}
            onMoveLine={moveLine}
            onUnlockPrices={unlockPrices}
            onResetOverrides={resetOverrides}
            onChangeMaterialMarkup={(v) => patchSession({ materialMarkupPct: v })}
            onChangeLaborMarkup={(v) => patchSession({ laborMarkupPct: v })}
            onChangeTax={(v) => patchSession({ taxPct: v })}
            onChangeDiscount={(v) => patchSession({ discountPct: v })}
            onChangeDeliveryMiles={(v) => patchSession({ deliveryMiles: v })}
            onChangeDeliveryRate={(v) => patchSession({ deliveryPerMile: v })}
            onBack={goHome}
            onContinue={() => { setView('details'); persistQuote(); }}
          />
        )}

        {activeView === 'details' && session && (
          <QuoteForm
            type={session.type}
            state={session.state}
            totals={totals}
            designRef={session.designRef}
            customer={session.customer}
            notes={session.notes}
            depositPct={session.depositPct}
            features={session.features}
            attachments={session.attachments}
            quoteId={session.quoteId}
            onChangeCustomer={setCustomer}
            onChangeNotes={(v) => patchSession({ notes: v })}
            onChangeFeatures={(v) => patchSession({ features: v })}
            onChangeAttachments={(v) => patchSession({ attachments: v })}
            onChangeDeposit={(v) => patchSession({ depositPct: v })}
            onBack={() => setView('configure')}
            onPreview={openCustomerPage}
            onPersist={persistQuote}
          />
        )}

        {activeView === 'pricebook' && (
          <PriceBookPanel
            priceBook={priceBook}
            onChange={updatePriceBook}
            shop={shop}
            onChangeShop={updateShop}
            onReset={resetPriceBook}
            readOnly={!canEditRates}
          />
        )}
      </div>
    </div>
  );
}
