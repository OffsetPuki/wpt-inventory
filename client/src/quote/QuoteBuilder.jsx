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
import { buildLineState } from './lib/estimate.js';
import { computeTotals } from './lib/quote.js';
import {
  deepMerge, DEFAULT_SHOP, loadSession, saveSession, setPath,
} from './lib/store.js';

import Home from './components/Home.jsx';
import Configurator from './components/Configurator.jsx';
import QuoteForm from './components/QuoteForm.jsx';
import PrintQuote from './components/PrintQuote.jsx';
import PriceBookPanel from './components/PriceBookPanel.jsx';
import FindDesign from './components/FindDesign.jsx';
import SavedQuotes from './components/SavedQuotes.jsx';

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
    deliveryMiles: sess.deliveryMiles ?? 0,
    deliveryPerMile: sess.deliveryPerMile ?? priceBook.deliveryPerMile,
    quoteId: sess.quoteId ?? null,
    sid: sess.sid ?? newSid(),
  };
}

export default function QuoteBuilder({ initialSettings }) {
  const qc = useQueryClient();

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
  // removes the content padding; qa-printing hides the shell chrome so the
  // printable quote is the only thing on paper.
  useEffect(() => {
    document.body.classList.add('qa-page');
    return () => { document.body.classList.remove('qa-page', 'qa-printing'); };
  }, []);
  useEffect(() => {
    document.body.classList.toggle('qa-printing', view === 'print');
    if (view !== 'print') return;
    // @page can't be scoped by selector, so keep the quote's 18mm print
    // margins mounted only while the print view is open — printing any other
    // suite page keeps the browser's default margins.
    const style = document.createElement('style');
    style.textContent = '@media print { @page { margin: 18mm; } }';
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, [view]);

  // ── Auto-save to the suite ──────────────────────────────────────────────────
  // First save (entering details) creates the row and brings back the server-
  // assigned number; later transitions update the same row.
  const resaveQueued = useRef(false);
  const persistQuoteRef = useRef(() => {});
  const saveQuote = useMutation({
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
      setSession((s) => (s && s.sid === sess.sid ? { ...s, quoteId: row.id, number: row.number } : s));
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
  const lineState = useMemo(
    () => (session ? buildLineState(session.type, session.state, priceBook, session.overrides) : null),
    [session, priceBook],
  );
  const totals = useMemo(
    () => (lineState ? computeTotals(lineState, {
      materialMarkupPct: session.materialMarkupPct,
      laborMarkupPct: session.laborMarkupPct,
      taxPct: session.taxPct,
      deliveryMiles: session.deliveryMiles,
      deliveryPerMile: session.deliveryPerMile,
    }) : null),
    [lineState, session],
  );

  const persistQuote = () => {
    if (!session) return;
    // One save in flight at a time — a quick configure → details → print run
    // must not fire a second POST before the first returns the quote id. The
    // skipped save is queued and replayed from onSettled.
    if (saveQuote.isPending) { resaveQueued.current = true; return; }
    saveQuote.mutate({ sess: session, totalCents: Math.round((totals?.total ?? 0) * 100) });
  };
  persistQuoteRef.current = persistQuote;

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
  const resetOverrides = () => setSession((s) => ({ ...s, overrides: {} }));
  const setCustomer = (field, value) =>
    setSession((s) => ({ ...s, customer: { ...s.customer, [field]: value } }));

  // ── Navigation ──────────────────────────────────────────────────────────────
  const startConfig = (type) => { const sess = newSession(type, priceBook); setSession(sess); setView('configure'); };
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
    setSession(sess);
    setView('configure');
  };

  // Reopen a saved quote from the suite — edits keep saving to the same number.
  const openSaved = (sess) => {
    setSession(migrateSession(sess, priceBook));
    setView('configure');
  };

  // ── Price book ──────────────────────────────────────────────────────────────
  const updatePriceBook = (path, value) => { settingsDirty.current = true; setPriceBook((pb) => setPath(pb, path, value)); };
  const updateShop = (field, value) => { settingsDirty.current = true; setShop((sh) => ({ ...sh, [field]: value })); };
  const resetPriceBook = () => {
    if (window.confirm('Reset all rates to the defaults?')) {
      settingsDirty.current = true;
      setPriceBook({ ...DEFAULT_PRICE_BOOK });
    }
  };

  const inQuoteFlow = view === 'home' || view === 'configure' || view === 'details' || view === 'print';

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
            <button className={view === 'pricebook' ? 'active' : ''} onClick={() => setView('pricebook')}>Price book</button>
          </nav>
        </header>

        {activeView === 'home' && <Home onPick={startConfig} onFind={() => setView('find')} />}

        {activeView === 'find' && (
          <FindDesign onStartQuote={startFromLead} />
        )}

        {activeView === 'saved' && (
          <SavedQuotes onOpen={openSaved} />
        )}

        {activeView === 'configure' && session && (
          <Configurator
            type={session.type}
            state={session.state}
            lineState={lineState}
            totals={totals}
            materialMarkupPct={session.materialMarkupPct}
            laborMarkupPct={session.laborMarkupPct}
            taxPct={session.taxPct}
            deliveryMiles={session.deliveryMiles}
            deliveryRate={session.deliveryPerMile}
            onChangeOption={setStateField}
            onEditItem={editItem}
            onEditLabor={editLabor}
            onResetOverrides={resetOverrides}
            onChangeMaterialMarkup={(v) => patchSession({ materialMarkupPct: v })}
            onChangeLaborMarkup={(v) => patchSession({ laborMarkupPct: v })}
            onChangeTax={(v) => patchSession({ taxPct: v })}
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
            quoteId={session.quoteId}
            onChangeCustomer={setCustomer}
            onChangeNotes={(v) => patchSession({ notes: v })}
            onChangeDeposit={(v) => patchSession({ depositPct: v })}
            onBack={() => setView('configure')}
            onPreview={() => { setView('print'); persistQuote(); }}
            onPersist={persistQuote}
          />
        )}

        {activeView === 'print' && session && (
          <>
            <div className="print-toolbar no-print">
              <button className="btn ghost" onClick={() => setView('details')}>← Back to details</button>
              <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
              <span className="hint">
                {session.number
                  ? 'Choose "Save as PDF" in the dialog to send the customer a file.'
                  : '⚠ Not saved to the suite yet — the quote number appears once it saves. Go back and forward to retry.'}
              </span>
            </div>
            <PrintQuote
              shop={shop}
              type={session.type}
              state={session.state}
              designRef={session.designRef}
              customer={session.customer}
              notes={session.notes}
              depositPct={session.depositPct}
              number={session.number || '—'}
              createdAt={session.createdAt}
              lineState={lineState}
              totals={totals}
            />
          </>
        )}

        {activeView === 'pricebook' && (
          <PriceBookPanel
            priceBook={priceBook}
            onChange={updatePriceBook}
            shop={shop}
            onChangeShop={updateShop}
            onReset={resetPriceBook}
          />
        )}
      </div>
    </div>
  );
}
