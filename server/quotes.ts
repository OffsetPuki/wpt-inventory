import type { Express } from "express";
import crypto from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { sqlite, db } from "./storage";
import { audit } from "./audit";
import { requireAuth, requireElevated } from "./auth";
import { quotes, insertQuoteSchema, quoteSettingsSchema } from "../shared/quote-schema";
import { webDesignRowToLead } from "./public-api";
import { onQuoteEvent, logEmailActivity } from "./crm";
import { mailEnabled, sendMail } from "./mailer";
// The quote builder's own pricing engine — plain JS, pure functions + data
// (no React, no DOM), imported straight from client/src/quote so the costing
// report and buy list price with EXACTLY the math the builder uses. Same
// pattern as public-portal.ts.
import { buildLineState, lineCost, materialTotals } from "../client/src/quote/lib/estimate.js";
import { deepMerge } from "../client/src/quote/lib/store.js";
import { DEFAULT_PRICE_BOOK } from "../client/src/quote/data/priceBook.js";

// ─── Quote builder module ────────────────────────────────────────────────────
// Backs the ported CJM Quote app (client/src/quote). Three responsibilities:
//   · quotes           — every quote that reached the details step, one JSON
//                        session payload per row, server-assigned "Q-…" number
//   · quote_settings   — singleton: the shared price book + shop identity that
//                        used to live in the .exe's localStorage
//   · /api/quotes/designs — authenticated twin of GET /api/public/designs, so
//                        the embedded "Find design" screen needs no shared key

// ─── Table creation (synchronous DDL) ────────────────────────────────────────
// Mirrors shared/quote-schema.ts exactly.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    customer_name TEXT,
    design_ref TEXT,
    total_cents INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER,
    -- Soft delete: NULL = active.
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at);

  CREATE TABLE IF NOT EXISTS quote_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    price_book TEXT NOT NULL DEFAULT '{}',
    shop TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER
  );
`);

// Additive migration: the share/accept lifecycle arrived after installs
// existed. Existing rows default to 'draft' — exactly right, since none of
// them were ever shared. SQLite has no IF NOT EXISTS for columns — the throw
// on re-run is expected.
for (const col of [
  "share_token TEXT",
  "status TEXT NOT NULL DEFAULT 'draft'",
  "sent_at INTEGER",
  "accepted_at INTEGER",
  "accept_note TEXT",
  "accept_ip TEXT",
]) {
  try {
    sqlite.exec(`ALTER TABLE quotes ADD COLUMN ${col}`);
  } catch {
    /* column already exists */
  }
}

// Also used by public-portal.ts — the two modules parse the same stored
// quote payload / settings JSON.
export function parseJson<T>(s: unknown, fallback: T): T {
  if (typeof s !== "string") return fallback;
  try {
    const v = JSON.parse(s);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

// The payload column must always hold a JSON *object* — a stray string or
// array stored verbatim would 200 on write and then fail JSON.parse (or
// produce a session with no .type) when the Saved list reopens it.
function normalizePayload(body: Record<string, unknown>): void {
  if (body.payload === undefined) return;
  if (typeof body.payload !== "string") {
    body.payload = JSON.stringify(body.payload);
  }
  const parsed = parseJson<unknown>(body.payload as string, null);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("payload must be a JSON object");
  }
}

// The client deep-merges these objects over its defaults — a key literally
// named __proto__ would rewrite the merged price book's prototype.
function assertSafeKeys(obj: unknown, path = ""): void {
  if (obj == null || typeof obj !== "object") return;
  for (const k of Object.keys(obj)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      throw new Error(`illegal key "${k}"${path ? ` under ${path}` : ""}`);
    }
    assertSafeKeys((obj as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
  }
}

// The price book a stored session should be priced with: its own snapshot
// (rate versioning — quotes hold their prices) when present, else the current
// shared book. Both deep-merged over the defaults, identically to the builder.
function effectiveBook(sess: { priceBookSnapshot?: unknown } | null): Record<string, any> {
  if (sess?.priceBookSnapshot && typeof sess.priceBookSnapshot === "object") {
    return deepMerge(DEFAULT_PRICE_BOOK, sess.priceBookSnapshot as Record<string, unknown>);
  }
  const row = sqlite.prepare(
    "SELECT price_book FROM quote_settings WHERE id = 1",
  ).get() as { price_book?: string } | undefined;
  return deepMerge(DEFAULT_PRICE_BOOK, parseJson<Record<string, unknown>>(row?.price_book, {}));
}

// "Q-<year>-<0000>" — same allocation scheme as estimate numbers: seq seeded
// from max(id)+1, bounded retry on UNIQUE collision.
function insertQuoteWithNumber(
  values: Omit<typeof quotes.$inferInsert, "number">,
): typeof quotes.$inferSelect {
  const year = new Date().getFullYear();
  let seq = (db.select({ m: sql<number>`coalesce(max(${quotes.id}), 0)` })
    .from(quotes).get()?.m ?? 0) + 1;
  for (let attempt = 0; attempt < 50; attempt++, seq++) {
    const number = `Q-${year}-${String(seq).padStart(4, "0")}`;
    try {
      return db.insert(quotes).values({ ...values, number }).returning().get();
    } catch (e: any) {
      if (String(e?.message ?? e).includes("UNIQUE")) continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a quote number — too many collisions");
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerQuoteRoutes(app: Express): void {
  const pid = (v: string | string[]): number => parseInt(v as string, 10);

  // ─── Settings (literal path — registered before /:id) ────────────────────
  // The shared price book + shop identity. The client deep-merges these over
  // its own defaults, so an empty object simply means "all defaults".

  app.get("/api/quotes/settings", requireAuth, (_req, res) => {
    const row = sqlite.prepare(
      "SELECT price_book, shop FROM quote_settings WHERE id = 1",
    ).get() as { price_book?: string; shop?: string } | undefined;
    res.json({
      priceBook: parseJson(row?.price_book, {}),
      shop: parseJson(row?.shop, {}),
    });
  });

  app.put("/api/quotes/settings", requireAuth, (req, res) => {
    try {
      const data = quoteSettingsSchema.parse(req.body);
      assertSafeKeys(data.priceBook, "priceBook");
      assertSafeKeys(data.shop, "shop");
      sqlite.prepare(`
        INSERT INTO quote_settings (id, price_book, shop, updated_at)
        VALUES (1, @priceBook, @shop, @now)
        ON CONFLICT(id) DO UPDATE SET
          price_book = excluded.price_book,
          shop = excluded.shop,
          updated_at = excluded.updated_at
      `).run({
        priceBook: JSON.stringify(data.priceBook),
        shop: JSON.stringify(data.shop),
        now: Date.now(),
      });
      // The shared price book is the most financially consequential write in
      // this module — "who changed the labor rate and when" must be answerable.
      audit(req, "quote.settings_update");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ─── Stats (literal path — registered before /:id) ────────────────────────
  // Phase B #14: the dashboard's quotes tile. Counts by lifecycle status plus
  // the open pipeline — the money sitting in quotes the customer hasn't said
  // yes to yet (draft + sent; declined quotes are dead, accepted are closed).

  app.get("/api/quotes/stats", requireAuth, (_req, res) => {
    const rows = db.select({
      status: quotes.status,
      n: sql<number>`count(*)`,
      totalCents: sql<number>`coalesce(sum(${quotes.totalCents}), 0)`,
    }).from(quotes)
      .where(isNull(quotes.deletedAt))
      .groupBy(quotes.status)
      .all();
    const by = new Map(rows.map((r) => [r.status, r]));
    res.json({
      draft: by.get("draft")?.n ?? 0,
      sent: by.get("sent")?.n ?? 0,
      accepted: by.get("accepted")?.n ?? 0,
      openPipelineCents: (by.get("draft")?.totalCents ?? 0) + (by.get("sent")?.totalCents ?? 0),
    });
  });

  // ─── Design lookup (literal path — registered before /:id) ────────────────
  // Same rows and envelope as GET /api/public/designs, but behind the session
  // instead of the shared LEAD_INTAKE_KEY — the embedded Find design screen
  // has no URL/key settings anymore.

  app.get("/api/quotes/designs", requireAuth, (req, res) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref.trim().toUpperCase() : "";
    if (ref) {
      const rows = sqlite.prepare("SELECT * FROM web_designs WHERE upper(ref) = ?").all(ref);
      return res.json({ ok: true, leads: rows.map(webDesignRowToLead) });
    }
    const recent = Math.min(Math.max(parseInt(String(req.query.recent ?? "25"), 10) || 25, 1), 100);
    const rows = sqlite.prepare(
      "SELECT * FROM web_designs ORDER BY created_at DESC, id DESC LIMIT ?",
    ).all(recent);
    res.json({ ok: true, leads: rows.map(webDesignRowToLead) });
  });

  // ─── Costing report (literal path — registered before /:id) ───────────────
  // Quoted vs actual, per accepted quote. The quoted side re-derives from the
  // stored session (against its price-book snapshot). The actual side reads
  // the linked project (projects.job_number = quotes.number): expenses from
  // Finance, labor from PM time entries × the worker's HR pay rate (salary
  // pro-rated at 2080 h/yr) — the same math as the project finances card.
  // requireElevated: this exposes real pay-rate-derived costs, like finance.ts.

  app.get("/api/quotes/costing", requireElevated, (_req, res) => {
    const accepted = db.select().from(quotes)
      .where(and(eq(quotes.status, "accepted"), isNull(quotes.deletedAt)))
      .orderBy(desc(quotes.acceptedAt), desc(quotes.id))
      .all();

    const rows: any[] = [];
    for (const q of accepted) {
      try {
        const sess = parseJson<any>(q.payload, null);
        if (!sess || typeof sess !== "object" || !sess.state) continue;
        const book = effectiveBook(sess);
        const ls = buildLineState(q.type, sess.state, book, sess.overrides) as any;
        const materialCents = Math.round(
          (ls.items as any[]).reduce((s: number, it: any) => s + lineCost(it), 0) * 100,
        );
        const shopHours = Number(ls.labor?.hours) || 0;
        const installHours = Number(ls.install?.hours) || 0;
        const laborCents = Math.round((
          shopHours * (Number(ls.labor?.rate) || 0)
          + installHours * (Number(ls.install?.rate) || 0)
        ) * 100);

        const project = sqlite.prepare(
          "SELECT id, status FROM projects WHERE job_number = ? AND deleted_at IS NULL",
        ).get(q.number) as { id: number; status: string } | undefined;

        let actual: any = null;
        if (project) {
          const exp = sqlite.prepare(`
            SELECT
              COALESCE(SUM(CASE WHEN category = 'materials' THEN amount_cents ELSE 0 END), 0) AS materials,
              COALESCE(SUM(CASE WHEN category != 'materials' THEN amount_cents ELSE 0 END), 0) AS other
            FROM fin_expenses WHERE project_id = ? AND deleted_at IS NULL
          `).get(project.id) as { materials: number; other: number };
          const times = sqlite.prepare(`
            SELECT user_id AS userId, COALESCE(SUM(duration_min), 0) AS minutes
            FROM pm_time_entries
            WHERE project_id = ? AND ended_at IS NOT NULL
            GROUP BY user_id
          `).all(project.id) as { userId: number; minutes: number }[];
          let laborMinutes = 0;
          let laborCostCents = 0;
          for (const t of times) {
            laborMinutes += t.minutes;
            const emp = sqlite.prepare(
              "SELECT pay_type, pay_rate_cents FROM hr_employees WHERE user_id = ?",
            ).get(t.userId) as { pay_type?: string; pay_rate_cents?: number } | undefined;
            const hourly = !emp?.pay_rate_cents ? 0
              : emp.pay_type === "salary" ? emp.pay_rate_cents / 2080 : emp.pay_rate_cents;
            laborCostCents += Math.round((t.minutes / 60) * hourly);
          }
          actual = {
            materialCents: exp.materials,
            otherExpenseCents: exp.other,
            laborMinutes,
            laborCostCents,
          };
        }

        rows.push({
          quoteId: q.id,
          number: q.number,
          type: q.type,
          customerName: q.customerName,
          acceptedAt: q.acceptedAt,
          totalCents: q.totalCents,
          projectId: project?.id ?? null,
          projectStatus: project?.status ?? null,
          quoted: { materialCents, shopHours, installHours, laborCents },
          actual,
        });
      } catch {
        /* one unreadable payload must not kill the report */
      }
    }
    res.json({ rows });
  });

  // ─── Buy list (literal path — registered before /:id) ─────────────────────
  // Aggregate the material cut lists of several quotes into one supplier
  // order: total ft of each tubing, bags, sets — waste included. Each quote is
  // priced against its own snapshot book, same as everywhere else.

  app.get("/api/quotes/buy-list", requireAuth, (req, res) => {
    const ids = String(req.query.ids ?? "")
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 50);
    if (ids.length === 0) return res.status(400).json({ message: "ids required" });

    const agg = new Map<string, { id: string; name: string; unit: string; qty: number }>();
    const perQuote: any[] = [];
    for (const id of ids) {
      const q = db.select().from(quotes)
        .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
        .get();
      if (!q) continue;
      try {
        const sess = parseJson<any>(q.payload, null);
        if (!sess || typeof sess !== "object" || !sess.state) continue;
        const book = effectiveBook(sess);
        const ls = buildLineState(q.type, sess.state, book, sess.overrides) as any;
        const mats = materialTotals(ls.items, book) as
          { id: string; name: string; unit: string; qty: number }[];
        perQuote.push({
          quoteId: q.id, number: q.number, type: q.type,
          customerName: q.customerName, materials: mats,
        });
        for (const m of mats) {
          const cur = agg.get(m.id) || { ...m, qty: 0 };
          cur.qty = Math.round((cur.qty + m.qty) * 100) / 100;
          agg.set(m.id, cur);
        }
      } catch {
        /* skip an unreadable payload */
      }
    }
    res.json({ combined: [...agg.values()], quotes: perQuote });
  });

  // ─── Quotes CRUD ──────────────────────────────────────────────────────────

  // List — payload excluded: it's the big JSON blob, and the Saved view only
  // needs the identity columns. GET /:id returns the full row.
  app.get("/api/quotes", requireAuth, (_req, res) => {
    // Phase F: which quotes' customers unsubscribed from automated follow-ups.
    // Same email resolution as the sweep (payload customer card, else the
    // linked website design), matched against the normalized opt-out list.
    let optedOut = new Set<number>();
    try {
      optedOut = new Set((sqlite.prepare(`
        SELECT q.id FROM quotes q
        LEFT JOIN web_designs d ON upper(d.ref) = upper(q.design_ref)
        JOIN email_optouts o ON o.email = lower(trim(
          coalesce(nullif(json_extract(q.payload, '$.customer.email'), ''), d.email)))
        WHERE q.deleted_at IS NULL
      `).all() as { id: number }[]).map((r) => r.id));
    } catch {
      /* optouts/designs table absent — no flags */
    }
    res.json(
      db.select({
        id: quotes.id,
        number: quotes.number,
        type: quotes.type,
        customerName: quotes.customerName,
        designRef: quotes.designRef,
        totalCents: quotes.totalCents,
        status: quotes.status,
        sentAt: quotes.sentAt,
        acceptedAt: quotes.acceptedAt,
        fu1SentAt: quotes.fu1SentAt,
        fu2SentAt: quotes.fu2SentAt,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
      }).from(quotes)
        .where(isNull(quotes.deletedAt))
        .orderBy(desc(quotes.createdAt), desc(quotes.id))
        .all()
        .map((r) => ({ ...r, optedOut: optedOut.has(r.id) })),
    );
  });

  app.get("/api/quotes/:id", requireAuth, (req, res) => {
    const quote = db.select().from(quotes)
      .where(and(eq(quotes.id, pid(req.params.id)), isNull(quotes.deletedAt)))
      .get();
    if (!quote) return res.status(404).json({ message: "Quote not found" });
    res.json(quote);
  });

  app.post("/api/quotes", requireAuth, (req, res) => {
    try {
      const body = { ...req.body };
      normalizePayload(body);
      const data = insertQuoteSchema.parse(body);
      const row = insertQuoteWithNumber(data);
      audit(req, "quote.create", {
        targetType: "quote", targetId: row.id, targetName: row.number,
        details: { type: row.type, designRef: row.designRef },
      });
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/quotes/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const existing = db.select().from(quotes)
      .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
      .get();
    if (!existing) return res.status(404).json({ message: "Quote not found" });
    try {
      const body = { ...req.body };
      normalizePayload(body);
      const parsed = insertQuoteSchema.partial().parse(body);
      const row = db.update(quotes)
        .set({ ...parsed, updatedAt: Date.now() })
        .where(eq(quotes.id, id))
        .returning()
        .get();
      res.json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/quotes/:id", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const target = db.select().from(quotes)
      .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
      .get();
    if (!target) return res.status(404).json({ message: "Quote not found" });
    db.update(quotes).set({ deletedAt: Date.now() }).where(eq(quotes.id, id)).run();
    audit(req, "quote.delete", {
      targetType: "quote", targetId: id, targetName: target.number,
    });
    res.status(204).end();
  });

  // ─── Share (customer-facing link) ─────────────────────────────────────────
  // Mints the public /quote/<token> URL on the website. First share moves a
  // draft to 'sent' and stamps sent_at; re-sharing reuses the same token so a
  // link already in the customer's inbox never goes dead.

  const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://www.cjmmetals.com";

  app.post("/api/quotes/:id/share", requireAuth, async (req, res) => {
    const id = pid(req.params.id);
    const quote = db.select().from(quotes)
      .where(and(eq(quotes.id, id), isNull(quotes.deletedAt)))
      .get();
    if (!quote) return res.status(404).json({ message: "Quote not found" });

    const token = quote.shareToken ?? crypto.randomBytes(24).toString("hex");
    const updates: Partial<typeof quotes.$inferInsert> = { shareToken: token };
    if (quote.status === "draft") {
      updates.status = "sent";
      updates.sentAt = Date.now();
    }
    db.update(quotes).set(updates).where(eq(quotes.id, id)).run();

    const url = `${PUBLIC_SITE_URL}/quote/${token}`;

    // Email the customer the link when asked — explicit address wins, else the
    // one they typed into the builder's customer card (stored in the payload).
    let emailed = false;
    const cust = parseJson<{ customer?: { email?: string; phone?: string } }>(
      quote.payload, {},
    ).customer ?? {};
    const to = (typeof req.body?.email === "string" && req.body.email.trim())
      || cust.email
      || "";

    // CRM bridge: a shared quote counts as "quote sent" for a matching lead —
    // and creates the lead when the contact is new to CRM (Fix 3).
    onQuoteEvent("sent", {
      quoteNumber: quote.number,
      name: quote.customerName,
      email: to,
      phone: cust.phone,
      designRef: quote.designRef,
    });
    if (req.body?.sendEmail && to && mailEnabled()) {
      emailed = await sendMail({
        to,
        subject: `Your quote from CJM Metals — ${quote.number}`,
        text:
          `Hi ${quote.customerName || "there"},\n\n` +
          `Your quote ${quote.number} from CJM Metals is ready. View it (and accept it online) here:\n\n` +
          `${url}\n\n` +
          `Questions? Just reply to this email or give us a call.\n\n` +
          `— CJM Metals · Arlington, TX`,
      });
      // Phase B #9: the share email on the lead's timeline (matched by
      // address — onQuoteEvent above creates the lead if it's new to CRM).
      if (emailed) {
        logEmailActivity({
          email: to,
          subject: `Quote ${quote.number} sent — share link emailed`,
        });
      }
    }

    audit(req, "quote.share", {
      targetType: "quote", targetId: id, targetName: quote.number,
      details: { emailed, firstShare: quote.status === "draft" },
    });
    res.json({ ok: true, token, url, emailed });
  });
}
