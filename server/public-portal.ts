import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, sqlite, storage } from "./storage";
import { hasLeadKey } from "./public-api";
import { mailEnabled, sendMail, sendOwnerMail } from "./mailer";
import { parseJson } from "./quotes";
import { quotes, QUOTE_TYPES, QUOTE_TYPE_LABELS, type Quote } from "../shared/quote-schema";
import { reviews, marketingSettings, mkTasks } from "../shared/marketing-schema";
import { invoices } from "../shared/finance-schema";
import { projects } from "../shared/schema";
import { onQuoteEvent, findOrCreateClientByContact } from "./crm";
import { insertNumbered } from "./finance";
// The quote builder's own pricing engine — plain JS, pure functions + data
// (no React, no DOM), imported straight from client/src/quote so the server
// prices a design with EXACTLY the math the builder and the printed quote use.
import { deriveItems, lineCost, buildLineState } from "../client/src/quote/lib/estimate.js";
import { computeTotals } from "../client/src/quote/lib/quote.js";
import { distributeToTotal } from "../client/src/quote/lib/calc.js";
import { deepMerge, DEFAULT_SHOP } from "../client/src/quote/lib/store.js";
import { DEFAULT_PRICE_BOOK } from "../client/src/quote/data/priceBook.js";

// ─── Public portal: the website's customer-facing endpoints ─────────────────
// No session auth on any of these — the callers are visitors on
// www.cjmmetals.com (via the site's server-side proxies):
//   POST /api/public/estimate                — configurator ballpark price
//   GET  /api/public/status?ref=CJM-XXXX     — "where's my quote" tracker
//   GET  /api/public/quote/:token            — shared quote page
//   POST /api/public/quote/:token/accept     — customer accepts online
//   GET  /api/public/review-request/:token   — review-invitation landing
//   POST /api/public/review-submit           — review-invitation submit
//   GET  /api/public/site-info               — lead-time banner feed
// Companion to public-api.ts (lead intake + feeds) — registered right after it.

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The effective price book: stored quote_settings rates deep-merged over the
// defaults — identical semantics to the builder (QuoteBuilder.jsx), so the
// public estimate and an owner-built quote always start from the same rates.
function currentPriceBook(): Record<string, any> {
  const row = sqlite.prepare(
    "SELECT price_book FROM quote_settings WHERE id = 1",
  ).get() as { price_book?: string } | undefined;
  return deepMerge(DEFAULT_PRICE_BOOK, parseJson<Record<string, unknown>>(row?.price_book, {}));
}

function currentShop(): { name: string; location: string; phone: string; email: string } {
  const row = sqlite.prepare(
    "SELECT shop FROM quote_settings WHERE id = 1",
  ).get() as { shop?: string } | undefined;
  const shop = deepMerge(DEFAULT_SHOP, parseJson<Record<string, unknown>>(row?.shop, {}));
  return { name: shop.name, location: shop.location, phone: shop.phone, email: shop.email };
}

const iso = (ms: number | null | undefined): string | null =>
  ms != null ? new Date(ms).toISOString() : null;

// Hourly per-IP limiter, same shape as the intake/design limiters next door.
// The website's server proxies every visitor through one egress IP — its keyed
// requests skip these limits (the site throttles per visitor on its side).
const publicLimiter = (max: number) => rateLimit({
  windowMs: 60 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: hasLeadKey,
  message: { ok: false, error: "rate limited" },
});

// quotes.share_token is 24 random bytes hex-encoded.
const TOKEN_RE = /^[0-9a-f]{48}$/i;

// What calcQuote (lib/calc.js) returns, as far as this module reads it. The
// engine builds `lines` dynamically, so TypeScript infers it as {} — this
// pins the shape the printed quote already relies on.
interface CalcTotals {
  lines: Record<"material" | "labor" | "finishing" | "delivery", { total: number }>;
  subtotal: number;
  tax: number;
  taxPct: number;
  total: number;
  discountPct: number;
  discountAmt: number;
  minAdjustment: number;
}

// ─── Best-effort quote lines ─────────────────────────────────────────────────
// Rebuild the printed document's rows (material items with markup blended in,
// then labor / install / delivery / tax) from the stored builder session.
// Quotes saved by the material-library builder carry a SNAPSHOT of the price
// book they were priced with (rate versioning) — rebuild against that, so the
// page stays itemized even after rates move. Older quotes without a snapshot
// fall back to the current book; if the rebuild doesn't reconcile to the cent
// with the stored total (what the customer was told) we return null and the
// page shows the total only. Never the cost basis, markup %, or labor rate.

function bestEffortLines(quote: Quote): { name: string; amountCents: number }[] | null {
  try {
    const sess = parseJson<any>(quote.payload, null);
    if (!sess || typeof sess !== "object" || !sess.state) return null;
    const book = sess.priceBookSnapshot && typeof sess.priceBookSnapshot === "object"
      ? deepMerge(DEFAULT_PRICE_BOOK, sess.priceBookSnapshot)
      : currentPriceBook();
    const lineState = buildLineState(quote.type, sess.state, book, sess.overrides);
    // `as` rather than `:` — the engine types `lines` as {} (built dynamically).
    const totals = computeTotals(lineState, {
      materialMarkupPct: sess.materialMarkupPct,
      laborMarkupPct: sess.laborMarkupPct,
      taxPct: sess.taxPct,
      deliveryMiles: sess.deliveryMiles,
      deliveryPerMile: sess.deliveryPerMile,
      discountPct: sess.discountPct,
      minJobCharge: (book as any).minJobCharge,
    }) as unknown as CalcTotals;
    if (Math.round(totals.total * 100) !== quote.totalCents) return null;

    // Same construction as PrintQuote.jsx: distribute the marked-up material
    // total across the items so the parts sum exactly to the material line.
    const items: any[] = lineState.items || [];
    const prices = distributeToTotal(items.map((it) => lineCost(it)), totals.lines.material.total);
    const lines = items
      .map((it, i) => ({ name: String(it.name), amountCents: Math.round(prices[i] * 100) }))
      .filter((l) => l.amountCents > 0);
    if (totals.lines.labor.total > 0) {
      lines.push({ name: "Labor & fabrication", amountCents: Math.round(totals.lines.labor.total * 100) });
    }
    if (totals.lines.finishing.total > 0) {
      lines.push({ name: "Installation", amountCents: Math.round(totals.lines.finishing.total * 100) });
    }
    if (totals.lines.delivery.total > 0) {
      lines.push({ name: "Delivery", amountCents: Math.round(totals.lines.delivery.total * 100) });
    }
    if (totals.discountAmt > 0) {
      lines.push({ name: `Discount (${totals.discountPct}%)`, amountCents: -Math.round(totals.discountAmt * 100) });
    }
    if (totals.tax > 0) {
      lines.push({ name: `Sales tax (${totals.taxPct}%)`, amountCents: Math.round(totals.tax * 100) });
    }
    if (totals.minAdjustment > 0) {
      lines.push({ name: "Minimum job charge", amountCents: Math.round(totals.minAdjustment * 100) });
    }
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerPublicPortalRoutes(app: Express): void {
  // ─── Instant estimate (configurator ballpark) ─────────────────────────────
  // Returns ONLY a rounded low/high range. Line items, labor hours, rates and
  // price-book values never leave the server — a competitor hammering this
  // endpoint learns nothing about how the pricing is built. Tax excluded by
  // design (the range is pre-tax, like a verbal ballpark). Every failure mode
  // is a quiet { ok: false } — the website simply hides the range.

  app.post("/api/public/estimate", publicLimiter(60), (req, res) => {
    try {
      const type = req.body?.type;
      const state = req.body?.state;
      if (!(QUOTE_TYPES as readonly string[]).includes(type)) return res.json({ ok: false });
      if (state == null || typeof state !== "object" || Array.isArray(state)) {
        return res.json({ ok: false });
      }
      if (JSON.stringify(state).length > 8 * 1024) return res.json({ ok: false });

      const priceBook = currentPriceBook();
      const { items, laborHours, installHours } = deriveItems(type, state, priceBook) as {
        items: any[]; laborHours: number; installHours?: number;
      };
      const material = items.reduce((sum, it) => sum + lineCost(it), 0);
      const materialPrice = material * (1 + (Number(priceBook.materialMarkupPct) || 0) / 100);
      const laborMarkup = 1 + (Number(priceBook.laborMarkupPct) || 0) / 100;
      const laborPrice = (Number(laborHours) || 0)
        * (Number(priceBook.laborRatePerHour) || 0) * laborMarkup;
      const installPrice = (Number(installHours) || 0)
        * (Number(priceBook.installRatePerHour) || 0) * laborMarkup;
      // Small jobs still hit the shop's minimum charge (pre-tax, like the range).
      let base = materialPrice + laborPrice + installPrice;
      const minCharge = Number(priceBook.minJobCharge) || 0;
      if (base > 0 && minCharge > 0 && base < minCharge) base = minCharge;
      if (!(base > 0)) return res.json({ ok: false });

      // ±: -10% / +15% (installs surprise upward more often than down), each
      // end snapped to the nearest $50 so the range reads like a human wrote it.
      const to50 = (cents: number) => Math.round(cents / 5000) * 5000;
      res.json({
        ok: true,
        lowCents: to50(base * 0.90 * 100),
        highCents: to50(base * 1.15 * 100),
      });
    } catch {
      // The engine choked on a hand-crafted state — that's a "no estimate",
      // not a 500 worth alerting anyone over.
      res.json({ ok: false });
    }
  });

  // ─── Design status tracker ────────────────────────────────────────────────
  // "Where's my quote?" for a design code. Deliberately PII-free: the ref is
  // semi-public (it's in the customer's confirmation email), so the response
  // carries only step timestamps — no names, phones or emails.

  app.get("/api/public/status", publicLimiter(60), (req, res) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref.trim().toUpperCase() : "";
    if (!ref) return res.json({ ok: false });
    const design = sqlite.prepare(
      "SELECT ref, created_at FROM web_designs WHERE upper(ref) = ?",
    ).get(ref) as { ref: string; created_at: number } | undefined;
    if (!design) return res.json({ ok: false });

    const quoteRows = db.select({
      status: quotes.status,
      sentAt: quotes.sentAt,
      acceptedAt: quotes.acceptedAt,
    }).from(quotes)
      .where(and(
        isNull(quotes.deletedAt),
        sql`upper(${quotes.designRef}) = ${ref}`,
        inArray(quotes.status, ["sent", "accepted"]),
      ))
      .orderBy(desc(quotes.createdAt), desc(quotes.id))
      .all();
    const accepted = quoteRows.find((q) => q.status === "accepted");
    const quoted = accepted ?? quoteRows[0];

    res.json({
      ok: true,
      ref: design.ref,
      current: accepted ? "accepted" : quoted ? "quoted" : "received",
      steps: [
        { key: "received", at: iso(design.created_at), done: true },
        { key: "quoted", at: iso(quoted?.sentAt), done: !!quoted },
        { key: "accepted", at: iso(accepted?.acceptedAt), done: !!accepted },
      ],
    });
  });

  // ─── Shared quote page ────────────────────────────────────────────────────
  // The link the owner sends from the builder (POST /api/quotes/:id/share).
  // Drafts stay invisible even if a token somehow exists on one.

  const findSharedQuote = (token: string): Quote | undefined => {
    if (!TOKEN_RE.test(token)) return undefined;
    const quote = db.select().from(quotes)
      .where(and(eq(quotes.shareToken, token), isNull(quotes.deletedAt)))
      .get();
    return quote && quote.status !== "draft" ? quote : undefined;
  };

  app.get("/api/public/quote/:token", publicLimiter(120), (req, res) => {
    const quote = findSharedQuote(String(req.params.token));
    if (!quote) return res.status(404).json({ ok: false });

    const sess = parseJson<any>(quote.payload, {});
    const taxPct = Number(sess?.taxPct);
    res.json({
      ok: true,
      quote: {
        number: quote.number,
        type: quote.type,
        typeLabel: QUOTE_TYPE_LABELS[quote.type],
        customerName: quote.customerName,
        status: quote.status,
        totalCents: quote.totalCents,
        createdAt: iso(quote.createdAt.getTime()),
        sentAt: iso(quote.sentAt),
        acceptedAt: iso(quote.acceptedAt),
        shop: currentShop(),
        lines: bestEffortLines(quote),
        taxNote: Number.isFinite(taxPct) && taxPct > 0
          ? `Total includes ${taxPct}% sales tax.`
          : null,
      },
    });
  });

  app.post("/api/public/quote/:token/accept", publicLimiter(30), (req, res) => {
    const quote = findSharedQuote(String(req.params.token));
    if (!quote) return res.status(404).json({ ok: false });
    if (quote.status === "accepted") {
      return res.json({ ok: true, status: "accepted", alreadyAccepted: true });
    }

    // Tolerant of junk — a public form must not 400 over a weird note field.
    const note = typeof req.body?.note === "string"
      ? req.body.note.trim().slice(0, 1000)
      : "";
    const ip = req.ip ?? null;
    db.update(quotes).set({
      status: "accepted",
      acceptedAt: Date.now(),
      acceptNote: note || null,
      acceptIp: ip,
    }).where(eq(quotes.id, quote.id)).run();

    setImmediate(() => {
      try {
        storage.appendAudit({
          userId: null,
          userName: "cjmmetals.com",
          role: null,
          action: "quote.accepted",
          targetType: "quote",
          targetId: quote.id,
          targetName: quote.number,
          ip,
          details: { totalCents: quote.totalCents, hasNote: !!note },
        });
      } catch {
        /* audit is best-effort */
      }
    });

    // Accepted online → a job in Projects plus a DRAFT invoice for the owner
    // to review (never sent automatically). Deferred + try/catch'd: accepting
    // must never fail or slow down over bookkeeping — same stance as finance's
    // review hook. quote.number doubles as the dedupe key for both.
    // Fix 3 (wiring plan): the customer card resolves to a real CRM client so
    // the job + invoice carry clientId, not just a text name.
    const cust = parseJson<{ customer?: { email?: string; phone?: string } }>(
      quote.payload, {},
    ).customer ?? {};
    // Phase A #2: the deposit % the customer saw on the printed/shared quote
    // lives in the builder session next to taxPct. Stamped on the draft
    // invoice + surfaced on the "Schedule the job" task so it gets chased.
    const depositPct = Number(parseJson<{ depositPct?: unknown }>(quote.payload, {}).depositPct);
    const depositCents = Number.isFinite(depositPct) && depositPct > 0
      ? Math.round(quote.totalCents * (depositPct / 100))
      : null;
    setImmediate(() => {
      let projectId: number | null = null;
      let clientId: number | null = null;
      try {
        clientId = findOrCreateClientByContact({
          name: quote.customerName,
          email: cust.email,
          phone: cust.phone,
          designRef: quote.designRef,
        });
      } catch (e) {
        console.error("[public-portal] accept→client hook failed", e);
      }
      try {
        // job_number is UNIQUE and the quote number is too — an existing row
        // (even soft-deleted) means this job was already made once. A trashed
        // one gets restored: the task and owner email say "job is in
        // Projects", so it must actually be visible there.
        const existing = sqlite.prepare(
          "SELECT id, deleted_at FROM projects WHERE job_number = ?",
        ).get(quote.number) as { id: number; deleted_at: number | null } | undefined;
        if (existing) {
          if (existing.deleted_at != null) {
            sqlite.prepare("UPDATE projects SET deleted_at = NULL WHERE id = ?")
              .run(existing.id);
          }
          // Fix 3: a re-accept may know the client when the first pass didn't.
          if (clientId != null) {
            sqlite.prepare("UPDATE projects SET client_id = COALESCE(client_id, ?) WHERE id = ?")
              .run(clientId, existing.id);
          }
          projectId = existing.id;
        } else {
          projectId = db.insert(projects).values({
            jobNumber: quote.number,
            name: `${QUOTE_TYPE_LABELS[quote.type]}${quote.customerName ? ` — ${quote.customerName}` : ""}`,
            customer: quote.customerName,
            clientId,
            notes: `From quote ${quote.number} — accepted on cjmmetals.com`,
          }).returning().get().id;
        }
      } catch (e) {
        console.error("[public-portal] accept→project hook failed", e);
      }
      try {
        // Re-accept / double-click dedupe: skip if any live invoice already
        // references this quote number in its notes or line items.
        const dupe = sqlite.prepare(
          "SELECT id FROM fin_invoices WHERE deleted_at IS NULL AND (notes LIKE ? OR items LIKE ?)",
        ).get(`%${quote.number}%`, `%${quote.number}%`);
        if (dupe) return;

        // quote.totalCents is TAX-INCLUSIVE (the builder prices sales tax into
        // the total). Split it back into a pre-tax subtotal + tax so the draft
        // invoice doesn't record the tax-inclusive figure as its pre-tax
        // subtotal (which would double-tax downstream). The quote's tax rate
        // lives in its builder session payload as taxPct (a percent) — the same
        // field the shared quote page reads; no positive rate ⇒ no tax line.
        const quoteTaxPct = Number(parseJson<{ taxPct?: unknown }>(quote.payload, {}).taxPct);
        const taxRate = Number.isFinite(quoteTaxPct) && quoteTaxPct > 0 ? quoteTaxPct / 100 : 0;
        const subtotalCents = Math.round(quote.totalCents / (1 + taxRate));
        const taxCents = quote.totalCents - subtotalCents;
        const taxRateBp = Math.round(taxRate * 10000);

        // Line item priced PRE-TAX so sum(items) == subtotalCents: finance's
        // computeTotals re-derives subtotal from items and re-applies taxRateBp
        // on any later edit, so a tax-inclusive line item here would double-tax.
        const items = JSON.stringify([{
          description: `Quote ${quote.number} — ${QUOTE_TYPE_LABELS[quote.type]} (accepted online)`,
          qty: 1,
          unitPriceCents: subtotalCents,
        }]);
        // Shared MAX(id)+1, retry-on-UNIQUE INV numbering (finance.ts).
        insertNumbered("fin_invoices", "INV", (num) =>
          db.insert(invoices).values({
            number: num,
            clientId,
            clientName: quote.customerName,
            status: "draft",
            projectId,
            items,
            subtotalCents,
            taxRateBp,
            taxCents,
            totalCents: quote.totalCents,
            depositCents,
            notes: `From quote ${quote.number} — accepted on cjmmetals.com`,
          }).run(),
        );
      } catch (e) {
        console.error("[public-portal] accept→invoice hook failed", e);
      }
    });

    // The in-app ping: an open task due right now — shows in Marketing →
    // Tasks and trips the dashboard's overdue-tasks banner, so the acceptance
    // is visible in the suite even with email off. Deduped by open title.
    setImmediate(() => {
      try {
        const title = `Schedule the job — quote ${quote.number} accepted`
          + (quote.customerName ? ` by ${quote.customerName}` : "");
        const open = db.select({ id: mkTasks.id }).from(mkTasks)
          .where(and(eq(mkTasks.title, title), eq(mkTasks.status, "open")))
          .get();
        if (open) return;
        db.insert(mkTasks).values({
          title,
          kind: "follow_up",
          status: "open",
          autoCreated: true,
          dueAt: Date.now(),
          notes: `$${(quote.totalCents / 100).toFixed(2)} — job ${quote.number} is in Projects, draft invoice in Finance.`
            + (depositCents ? ` Deposit due: $${(depositCents / 100).toFixed(2)}.` : ""),
        }).run();
      } catch (e) {
        console.error("[public-portal] accept→task hook failed", e);
      }
    });

    // CRM bridge: a matching lead is won — stage, closed revenue, activity
    // note; an unknown contact gets a client + won lead created (Fix 3).
    onQuoteEvent("accepted", {
      quoteNumber: quote.number,
      name: quote.customerName,
      email: cust.email,
      phone: cust.phone,
      designRef: quote.designRef,
      totalCents: quote.totalCents,
    });

    if (mailEnabled()) {
      const text =
        `Quote ${quote.number} was accepted on cjmmetals.com.\n\n` +
        `Customer:  ${quote.customerName || "(no name on quote)"}\n` +
        `Project:   ${QUOTE_TYPE_LABELS[quote.type]}\n` +
        `Total:     $${(quote.totalCents / 100).toFixed(2)}\n` +
        (note ? `\nCustomer note:\n${note}\n` : "") +
        `\nIn the suite: job ${quote.number} in Projects, a draft invoice in ` +
        `Finance, and a follow-up task in Marketing → Tasks.`;
      setImmediate(() => {
        void sendOwnerMail({
          subject: `[CJM Suite] Quote accepted — ${quote.number}`,
          text,
        });
      });

      // Customer confirmation — the builder's customer-card email first
      // (same payload read as the share endpoint), else the linked website
      // design's. No address on file → skip silently.
      const to =
        parseJson<{ customer?: { email?: string } }>(quote.payload, {}).customer?.email
        || (quote.designRef
          ? (sqlite.prepare("SELECT email FROM web_designs WHERE upper(ref) = ?")
              .get(quote.designRef.toUpperCase()) as { email: string | null } | undefined)?.email
          : null)
        || "";
      if (to) {
        setImmediate(() => {
          void sendMail({
            to,
            subject: `Quote ${quote.number} accepted — CJM Metals`,
            text:
              `Hi ${quote.customerName || "there"},\n\n` +
              `Got it — your quote ${quote.number} is locked in. We'll call you ` +
              `to schedule the work.\n\n` +
              `— CJM Metals · Arlington, TX`,
          });
        });
      }
    }

    res.json({ ok: true, status: "accepted" });
  });

  // ─── Review invitations ───────────────────────────────────────────────────
  // Landing check + submit for the /review/<token> page. The check returns
  // the FIRST name only ("Thanks, Maria!") — never the full contact record.

  interface ReviewRequestRow {
    id: number;
    token: string;
    name: string | null;
    email: string | null;
    submitted_at: number | null;
  }
  const findReviewRequest = (token: string): ReviewRequestRow | undefined =>
    sqlite.prepare(
      "SELECT id, token, name, email, submitted_at FROM review_requests WHERE token = ?",
    ).get(String(token)) as ReviewRequestRow | undefined;

  app.get("/api/public/review-request/:token", publicLimiter(60), (req, res) => {
    const rr = findReviewRequest(String(req.params.token));
    if (!rr) return res.json({ ok: false, reason: "unknown" });
    if (rr.submitted_at != null) return res.json({ ok: false, reason: "used" });
    res.json({ ok: true, name: (rr.name ?? "").trim().split(/\s+/)[0] || "" });
  });

  const reviewSubmitSchema = z.object({
    token: z.string().trim().min(1).max(96),
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().max(2000).optional(),
    author: z.string().trim().max(120).optional(),
  });

  app.post("/api/public/review-submit", publicLimiter(30), (req, res) => {
    let body;
    try {
      body = reviewSubmitSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    const rr = findReviewRequest(body.token);
    if (!rr) return res.json({ ok: false, reason: "unknown" });
    if (rr.submitted_at != null) return res.json({ ok: false, reason: "used" });

    // Unpublished by default — the owner curates what the testimonials feed
    // shows, exactly like manually logged reviews.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const author = body.author || rr.name || null;
    const row = db.insert(reviews).values({
      source: "website",
      author,
      rating: body.rating,
      text: body.text || null,
      reviewDate: today,
      published: false,
    }).returning().get();
    sqlite.prepare(
      "UPDATE review_requests SET submitted_at = ?, review_id = ? WHERE id = ?",
    ).run(Date.now(), row.id, rr.id);

    // Negative-review fast lane: 1–3 stars lands an open task so the owner
    // responds quickly. Deferred + try/catch'd — submitting must never 500
    // over a marketing nicety. Deduped by open task title.
    if (body.rating <= 3) {
      const title = `Respond to ${author || "a customer"}'s ${body.rating}-star review`;
      setImmediate(() => {
        try {
          const open = db.select({ id: mkTasks.id }).from(mkTasks)
            .where(and(eq(mkTasks.title, title), eq(mkTasks.status, "open")))
            .get();
          if (open) return;
          db.insert(mkTasks).values({
            title,
            kind: "follow_up",
            status: "open",
            autoCreated: true,
            dueAt: Date.now(),
            notes: `Review #${row.id} via cjmmetals.com.`,
          }).run();
        } catch (e) {
          console.error("[public-portal] review-task hook failed", e);
        }
      });
    }

    if (mailEnabled()) {
      const text =
        `A customer just left a review via cjmmetals.com.\n\n` +
        `From:    ${author || "(anonymous)"}\n` +
        `Rating:  ${"★".repeat(body.rating)}${"☆".repeat(5 - body.rating)} (${body.rating}/5)\n` +
        `\n${body.text || "(no written review)"}\n` +
        `\nIt's unpublished — open Marketing → Reviews to publish it to the site.`;
      setImmediate(() => {
        void sendOwnerMail({
          subject: `[CJM Suite] New review — ${body.rating}/5${author ? ` from ${author}` : ""}`,
          text,
        });
      });
    }

    res.json({ ok: true });
  });

  // ─── Site info (lead-time banner) ─────────────────────────────────────────
  // Same cacheable CORS-open shape as the reviews/portfolio feeds. NULL means
  // the owner hasn't set a lead time → the website hides its banner.

  app.get("/api/public/site-info", publicLimiter(120), (_req, res) => {
    // Overrides the global /api no-store: this is a public marketing feed.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    const row = db.select({ leadTimeWeeks: marketingSettings.leadTimeWeeks })
      .from(marketingSettings)
      .where(eq(marketingSettings.id, 1))
      .get();
    res.json({ leadTimeWeeks: row?.leadTimeWeeks ?? null });
  });
}
