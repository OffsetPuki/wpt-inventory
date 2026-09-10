// =============================================================================
//  Quote builder — the standalone CJM Quote app, embedded in the suite.
//
//  What changed from the .exe version:
//    · Price book + shop identity live in the suite DB (/api/quotes/settings),
//      shared by every device. Edits save back automatically (debounced).
//    · Drafts auto-save to the suite after an editing pause.
//      The quote number is assigned by the server, and the Saved view
//      lists every quote from any device.
//    · "Find design" reads the suite's own web_designs table (no URL/key).
//  Everything else — pricing math, configurators, previews, the printable
//  quote — is the original code, untouched.
// =============================================================================
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { defaultState } from "./data/configurators.js";
import { DEFAULT_PRICE_BOOK } from "./data/priceBook.js";
import {
  buildLineState,
  deriveWarnings,
  materialTotals,
} from "./lib/estimate.js";
import { fetchLeads } from "./lib/leads.js";
import { parseLead } from "./lib/designSpec.js";
import { computeTotals } from "./lib/quote.js";
import {
  deepMerge,
  DEFAULT_SHOP,
  duplicateSession,
  loadSession,
  setPath,
} from "./lib/store.js";
import useDraftSave from "./lib/useDraftSave.js";
import { fmtMoney } from "./lib/format.js";
import Home from "./components/Home.jsx";
import Configurator from "./components/Configurator.jsx";
const QuoteForm = lazy(() => import("./components/QuoteForm.jsx"));
const PriceBookPanel = lazy(() => import("./components/PriceBookPanel.jsx"));
const FindDesign = lazy(() => import("./components/FindDesign.jsx"));
const SavedQuotes = lazy(() => import("./components/SavedQuotes.jsx"));
const Costing = lazy(() => import("./components/Costing.jsx"));
// Client-side session identity — correlates async save responses with the
// session that started them, so a slow POST can't stamp its quoteId/number
// onto a different quote the user has since switched to.
function newSid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
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
    customer: { name: "", company: "", phone: "", email: "", location: "" },
    notes: "",
    depositPct: 0,
    // What we built in — one design feature per line, printed as bullets.
    features: "",
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
    state: sess.type === 'table'
      ? { includeTop: 'no', topMaterial: '', topCost: '', ...sess.state }
      : sess.state,
    materialMarkupPct:
      sess.materialMarkupPct ?? legacy ?? priceBook.materialMarkupPct,
    laborMarkupPct: sess.laborMarkupPct ?? legacy ?? priceBook.laborMarkupPct,
    taxPct: sess.taxPct ?? priceBook.taxPct,
    deliveryMiles: sess.deliveryMiles ?? 0,
    deliveryPerMile: sess.deliveryPerMile ?? priceBook.deliveryPerMile,
    discountPct: sess.discountPct ?? 0,
    priceBookSnapshot: sess.priceBookSnapshot ?? null,
    priceBookSnapshotAt: sess.priceBookSnapshotAt ?? null,
    features: typeof sess.features === "string" ? sess.features : "",
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
    deepMerge(DEFAULT_PRICE_BOOK, initialSettings?.priceBook || {}),
  );
  const [shop, setShop] = useState(() =>
    deepMerge(DEFAULT_SHOP, initialSettings?.shop || {}),
  );
  const [session, setSession] = useState(() =>
    migrateSession(
      loadSession(),
      deepMerge(DEFAULT_PRICE_BOOK, initialSettings?.priceBook || {}),
    ),
  );
  const [view, setView] = useState("home");
  // settingsDirty is set only by the explicit edit paths (updatePriceBook /
  // updateShop / resetPriceBook) — not by an effect watching state — so a
  // StrictMode double-mount or remount never writes untouched settings back.
  const settingsDirty = useRef(false);
  const latestSettings = useRef({ priceBook, shop });
  useEffect(() => {
    latestSettings.current = { priceBook, shop };
  }, [priceBook, shop]);
  const putSettings = (body) =>
    apiRequest("PUT", "/api/quotes/settings", body).catch((e) => {
      settingsDirty.current = true; // keep it dirty so a later edit/flush retries
      toast({
        variant: "destructive",
        title: "Rates not saved",
        description: e?.message,
      });
    });
  useEffect(() => {
    if (!settingsDirty.current) return;
    if (!canEditRates) {
      settingsDirty.current = false;
      return;
    } // server would discard it
    // Mirror local state into the query cache right away so a remount within
    // the cache's staleTime (navigate away and back) can't revert the edits.
    qc.setQueryData(["quote-settings"], { priceBook, shop });
    const t = setTimeout(() => {
      settingsDirty.current = false;
      putSettings({ priceBook, shop });
    }, 800);
    return () => clearTimeout(t);
  }, [priceBook, shop]); // eslint-disable-line react-hooks/exhaustive-deps
  // Flush on unmount: leaving the page inside the debounce window must not
  // drop the last edit (the old app wrote localStorage synchronously; the
  // server-backed version needs this explicit goodbye write).
  useEffect(
    () => () => {
      if (settingsDirty.current) {
        settingsDirty.current = false;
        qc.setQueryData(["quote-settings"], latestSettings.current);
        putSettings(latestSettings.current);
      }
    },
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  // The suite shell (sidebar, padding) steps aside for this page: qa-page
  // removes the content padding. (The printable document itself lives on the
  // website — cjmmetals.com/quote/<token> — so there is no in-app print view.)
  useEffect(() => {
    document.body.classList.add("qa-page");
    return () => {
      document.body.classList.remove("qa-page");
    };
  }, []);
  // ── Derived pricing — only meaningful when a session exists ────────────────
  // A reopened quote carries a snapshot of the price book from when it was
  // saved; it prices against THAT book (old quotes don't move when rates
  // change). New/unlocked quotes price against the live book.
  const effectiveBook = useMemo(
    () =>
      session?.priceBookSnapshot
        ? deepMerge(DEFAULT_PRICE_BOOK, session.priceBookSnapshot)
        : priceBook,
    [session?.priceBookSnapshot, priceBook],
  );
  const lineState = useMemo(
    () =>
      session
        ? buildLineState(
            session.type,
            session.state,
            effectiveBook,
            session.overrides,
          )
        : null,
    [session?.type, session?.state, session?.overrides, effectiveBook],
  );
  const totals = useMemo(
    () =>
      lineState
        ? computeTotals(lineState, {
            materialMarkupPct: session.materialMarkupPct,
            laborMarkupPct: session.laborMarkupPct,
            taxPct: session.taxPct,
            deliveryMiles: session.deliveryMiles,
            deliveryPerMile: session.deliveryPerMile,
            discountPct: session.discountPct,
            minJobCharge: effectiveBook.minJobCharge,
          })
        : null,
    [lineState, session?.materialMarkupPct, session?.laborMarkupPct, session?.taxPct, session?.deliveryMiles, session?.deliveryPerMile, session?.discountPct, effectiveBook.minJobCharge],
  );
  // "Did you forget?" checklist + the per-material purchase totals (cut list).
  const warnings = useMemo(
    () =>
      session && lineState
        ? deriveWarnings(session.type, session.state, lineState, {
            materialMarkupPct: session.materialMarkupPct,
            laborMarkupPct: session.laborMarkupPct,
            taxPct: session.taxPct,
            deliveryMiles: session.deliveryMiles,
            discountPct: session.discountPct,
          })
        : [],
    [session?.type, session?.state, lineState, session?.materialMarkupPct, session?.laborMarkupPct, session?.taxPct, session?.deliveryMiles, session?.discountPct],
  );
  const materialsSummary = useMemo(
    () => (lineState ? materialTotals(lineState.items, effectiveBook) : []),
    [lineState, effectiveBook],
  );
  const draft = useDraftSave(session, setSession, effectiveBook, totals);
  const [reviewBusy, setReviewBusy] = useState(false);
  const flushQuote = () => draft.flush();
  const showSaveError = (error) => toast({ variant: "destructive", title: "Keep this draft open", description: error.message });
  const reviewQuote = async () => {
    setReviewBusy(true);
    try { await flushQuote(); setView("details"); window.scrollTo({ top: 0 }); }
    catch (error) { showSaveError(error); }
    finally { setReviewBusy(false); }
  };
  const issued = (result) => {
    draft.clear();
    setSession(null);
    setView("saved");
    toast({ variant: result?.wantedEmail && !result?.emailed ? "destructive" : "success",
      title: result?.wantedEmail && !result?.emailed ? "Quote issued, but email failed" : "Quote issued",
      description: result?.emailed ? "The customer email was sent. The issued copy is locked."
        : "The issued copy is locked. Its link is available under Send on the saved quote." });
  };
  // Switching drafts waits for the current draft. A failed/offline save leaves
  // the recovery copy intact instead of replacing it with a different quote.
  const replaceDraft = async (next, saved = false) => {
    if (session) { try { await flushQuote(); } catch (error) { showSaveError(error); return; } }
    draft.reset();
    setSession(next);
    if (saved) {
      const book = next.priceBookSnapshot ? deepMerge(DEFAULT_PRICE_BOOK, next.priceBookSnapshot) : priceBook;
      const lines = buildLineState(next.type, next.state, book, next.overrides);
      const amount = computeTotals(lines, { ...next, minJobCharge: book.minJobCharge }).total;
      draft.markSaved({ session: next, book, totalCents: Math.round(amount * 100) });
    }
    setView("configure");
    window.scrollTo({ top: 0 });
  };
  // ── Session mutators ────────────────────────────────────────────────────────
  const patchSession = (patch) => setSession((s) => ({ ...s, ...patch }));
  const setStateField = (name, value) =>
    setSession((s) => {
      const next = { ...s, state: { ...s.state, [name]: value } };
      // An explicit tabletop control edit wins over an older line edit.
      // Keep unrelated overrides (including customer-facing groups) intact.
      const resetField = { topCost: 'rate', topMaterial: 'name', qty: 'qty', includeTop: 'removed' }[name];
      if (s.type === 'table' && resetField && s.overrides?.items?.tabletop) {
        const tabletop = { ...s.overrides.items.tabletop };
        delete tabletop[resetField];
        next.overrides = { ...s.overrides, items: { ...s.overrides.items, tabletop } };
      }
      return next;
    });
  const editItem = (key, field, value) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      // The tabletop cost field and its line-item rate edit the same amount.
      if (s.type === 'table' && key === 'tabletop' && field === 'rate') {
        items[key] = { ...(items[key] || {}) };
        delete items[key].rate;
        return { ...s, state: { ...s.state, topCost: value }, overrides: { ...s.overrides, items } };
      }
      items[key] = { ...(items[key] || {}), [field]: value };
      return { ...s, overrides: { ...s.overrides, items } };
    });
  const editLabor = (field, value) =>
    setSession((s) => ({
      ...s,
      overrides: {
        ...s.overrides,
        labor: { ...(s.overrides.labor || {}), [field]: value },
      },
    }));
  const editInstall = (field, value) =>
    setSession((s) => ({
      ...s,
      overrides: {
        ...s.overrides,
        install: { ...(s.overrides.install || {}), [field]: value },
      },
    }));
  const resetOverrides = () => setSession((s) => ({ ...s, overrides: {} }));
  // Custom lines live in overrides (flagged `custom`) so they survive option
  // changes and reprice-resets are explicit.
  // spec = { name, kind, rate, materialId?, unit? } from the add-line form.
  const addCustomLine = (spec) =>
    setSession((s) => {
      const items = { ...(s.overrides.items || {}) };
      items[`custom_${Date.now()}`] = {
        custom: true,
        name: "Custom line",
        kind: "flat",
        qty: 1,
        rate: 0,
        ...spec,
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
    setSession((s) => ({
      ...s,
      priceBookSnapshot: null,
      priceBookSnapshotAt: null,
    }));
  const setCustomer = (field, value) =>
    setSession((s) => ({ ...s, customer: { ...s.customer, [field]: value } }));
  // ── Navigation ──────────────────────────────────────────────────────────────
  // Customer waiting to be stamped onto the next new quote — set by the
  // "Quote this lead" handoff below when the lead has no website design.
  const pendingCustomer = useRef(null);
  const [startingCustomer, setStartingCustomer] = useState({});
  const pendingLead = useRef(null);
  const startConfig = (type) => {
    const sess = newSession(type, priceBook);
    sess.customer = { ...sess.customer, ...startingCustomer };
    sess.leadId = pendingLead.current;
    pendingLead.current = null;
    if (pendingCustomer.current) {
      sess.customer = { ...sess.customer, ...pendingCustomer.current };
      pendingCustomer.current = null;
    }
    replaceDraft(sess);
  };
  const goHome = () => setView("home");
  // A looked-up website design becomes a quote: the customer's options overlay
  // the defaults, their contact info fills the customer card, and the design
  // code rides along onto the recap + PDF.
  const startFromLead = (lead, parsed) => {
    const sess = newSession(parsed.type, priceBook);
    sess.state = { ...sess.state, ...parsed.state };
    sess.customer = {
      name: lead.name || "",
      company: "",
      phone: lead.phone || "",
      email: lead.email || "",
      location: lead.location || "",
    };
    sess.designRef = lead.ref || "";
    sess.leadId = lead.leadId || pendingLead.current || null;
    pendingLead.current = null;
    // A trades-planner lead carries its multi-trade scope as prose — parseLead
    // hands it back as `notes` so the plan lands on the quote screen.
    if (parsed.notes) sess.notes = parsed.notes;
    replaceDraft(sess);
  };
  // "Quote this lead" handoff from the CRM (pages/crm/leads.tsx): the lead
  // modal stores { name, phone, email, designRef } under this key and
  // navigates here. With a designRef we run the same design-import path Find
  // design uses (startFromLead), so the configurator state loads too; without
  // one the customer waits in pendingCustomer for the next "New quote" pick.
  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem("cjm.quote.prefillLead");
      if (raw != null) sessionStorage.removeItem("cjm.quote.prefillLead");
    } catch {
      /* storage unavailable */
    }
    if (!raw) return;
    let lead;
    try {
      lead = JSON.parse(raw);
    } catch {
      return;
    }
    const customer = {
      name: lead.name || "",
      company: "",
      phone: lead.phone || "",
      email: lead.email || "",
      location: "",
    };
    pendingCustomer.current = customer;
    setStartingCustomer(customer);
    pendingLead.current = lead.leadId || null;
    setView("home");
    if (!lead.designRef) return;
    fetchLeads({ ref: lead.designRef })
      .then((rows) => {
        const row = rows.find((r) => parseLead(r));
        if (!row) return; // design not found — plain customer prefill stays pending
        pendingCustomer.current = null;
        startFromLead(
          {
            ...row,
            name: row.name || customer.name,
            phone: row.phone || customer.phone,
            email: row.email || customer.email,
          },
          parseLead(row),
        );
      })
      .catch(() => {
        /* lookup failed — plain customer prefill stays pending */
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Reopen a saved quote from the suite — edits keep saving to the same number.
  const openSaved = (sess) => replaceDraft(migrateSession(sess, priceBook), true);
  const duplicateSaved = (sess) => replaceDraft(duplicateSession(migrateSession(sess, priceBook), newSid()));
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
    setShop((sh) =>
      field.includes(".")
        ? setPath(sh, field, value)
        : { ...sh, [field]: value },
    );
  };
  const resetPriceBook = () => {
    if (window.confirm("Reset all rates to the defaults?")) {
      settingsDirty.current = true;
      setPriceBook({ ...DEFAULT_PRICE_BOOK });
    }
  };
  const inQuoteFlow =
    view === "home" || view === "configure" || view === "details";
  // Guard: flow views need a session.
  const activeView = inQuoteFlow && view !== "home" && !session ? "home"
    : view === 'configure' && session?.quoteStatus && session.quoteStatus !== 'draft' ? 'details' : view;
  return (
    <div className="qa">
      <div className="app">
        <header className="topbar no-print">
          <nav className="topnav">
            <button className={inQuoteFlow ? "active" : ""} onClick={goHome}>
              New quote
            </button>
            <button
              className={view === "find" ? "active" : ""}
              onClick={() => setView("find")}
            >
              Find design
            </button>
            <button
              className={view === "saved" ? "active" : ""}
              onClick={() => setView("saved")}
            >
              Saved
            </button>
            <button
              className={view === "costing" ? "active" : ""}
              onClick={() => setView("costing")}
            >
              Costing
            </button>
            <button
              className={view === "pricebook" ? "active" : ""}
              onClick={() => setView("pricebook")}
            >
              Price book
            </button>
          </nav>
        </header>
        <Suspense fallback={<p className="container hint" role="status">Loading…</p>}>
        {activeView === "home" && (
          <Home
            customer={startingCustomer}
            onChangeCustomer={(field, value) => { pendingCustomer.current = null; setStartingCustomer(c => ({ ...c, [field]: value })); }}
            onPick={startConfig}
            onFind={() => setView("find")}
            onContinue={session ? () => setView("configure") : null}
            draftName={
              session?.customer?.name || session?.number || "Your current draft"
            }
          />
        )}
        {activeView === "find" && <FindDesign onStartQuote={startFromLead} />}
        {activeView === "saved" && (
          <SavedQuotes onOpen={openSaved} onDuplicate={duplicateSaved} />
        )}
        {activeView === "costing" && (
          <Costing priceBook={priceBook} onChangePriceBook={updatePriceBook} />
        )}
        {activeView === "configure" && session && (
          <Configurator
            key={session.sid}
            customer={session.customer}
            onChangeCustomer={setCustomer}
            type={session.type}
            state={session.state}
            lineState={lineState}
            totals={totals}
            warnings={warnings}
            materialsSummary={materialsSummary}
            priceLockAt={
              session.priceBookSnapshot
                ? session.priceBookSnapshotAt || session.createdAt
                : null
            }
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
            onChangeMaterialMarkup={(v) =>
              patchSession({ materialMarkupPct: v })
            }
            onChangeLaborMarkup={(v) => patchSession({ laborMarkupPct: v })}
            onChangeTax={(v) => patchSession({ taxPct: v })}
            onChangeDiscount={(v) => patchSession({ discountPct: v })}
            onChangeDeliveryMiles={(v) => patchSession({ deliveryMiles: v })}
            onChangeDeliveryRate={(v) => patchSession({ deliveryPerMile: v })}
            onBack={goHome}
            onContinue={reviewQuote}
          />
        )}
        {activeView === "details" && session && (
          <QuoteForm
            key={session.sid}
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
            quoteStatus={session.quoteStatus}
            onChangeCustomer={setCustomer}
            onChangeNotes={(v) => patchSession({ notes: v })}
            onChangeFeatures={(v) => patchSession({ features: v })}
            onChangeAttachments={(v) => patchSession({ attachments: v })}
            onChangeDeposit={(v) => patchSession({ depositPct: v })}
            onBack={() => setView("configure")}
            version={session.version}
            saveStatus={draft.status}
            warnings={warnings}
            lineState={lineState}
            onPersist={flushQuote}
            onIssued={issued}
            onShared={() => { setSession(s => s?.sid === session.sid ? {...s,quoteStatus:'sent'} : s); document.querySelector('.review-actions')?.scrollIntoView({block:'center'}); }}
          />
        )}
        {activeView === "pricebook" && (
          <PriceBookPanel
            priceBook={priceBook}
            onChange={updatePriceBook}
            shop={shop}
            onChangeShop={updateShop}
            onReset={resetPriceBook}
            readOnly={!canEditRates}
          />
        )}
        </Suspense>
        {session && (activeView === "configure" || activeView === "details") && (
          <div className="quote-actionbar">
            <div><span className="hint">Total</span><strong>${fmtMoney(totals?.total || 0)}</strong></div>
            <div className="draft-status" role="status" aria-live="polite">
              <span>{draft.status}{draft.status === 'Saving' ? '…' : ''}</span>
              {!draft.localSaved && <small>Device backup unavailable. Keep this page open until saved.</small>}
              {draft.status === 'Offline' && <small>Sync resumes when connected</small>}
              {draft.error && draft.status !== 'Offline' && <small>{draft.error.message}</small>}
              {['Not saved', 'Offline'].includes(draft.status) && <button className="back-link" onClick={() => draft.retry().catch(showSaveError)}>Retry save</button>}
              {(draft.status === 'Conflict' || draft.error?.status === 404) && <button className="back-link" onClick={() => {
                if (!window.confirm('Keep these edits as a new draft? The other saved version will stay unchanged.')) return;
                const copy = { ...session, sid: newSid(), quoteId: null, number: null, version: 1, quoteStatus: 'draft', createdAt: new Date().toISOString() };
                draft.reset(); setSession(copy);
              }}>Keep edits as new quote</button>}
            </div>
            {activeView === "configure" ? <button className="btn" disabled={reviewBusy} onClick={reviewQuote}>{reviewBusy ? 'Saving…' : 'Review quote'} <span aria-hidden="true">→</span></button>
              : <div id="quote-send-actions" />}
          </div>
        )}
      </div>
    </div>
  );
}
