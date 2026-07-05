import type { Express, Request } from "express";
import crypto from "crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { sqlite, db, storage } from "./storage";
import { requireAuth } from "./auth";
import { quotes, insertQuoteSchema, quoteSettingsSchema } from "../shared/quote-schema";
import { webDesignRowToLead } from "./public-api";
import { mailEnabled, sendMail } from "./mailer";

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

function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "?") as string;
}

// Same fire-and-forget audit pattern as routes.ts/crm.ts: snapshot request-
// derived fields synchronously, then defer the insert off the response path.
function audit(req: Request, action: string, extras: {
  targetType?: string | null;
  targetId?: number | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
} = {}): void {
  const entry = {
    userId: req.user?.userId ?? null,
    userName: req.user?.name ?? null,
    role: req.user?.role ?? null,
    action,
    targetType: extras.targetType ?? null,
    targetId: extras.targetId ?? null,
    targetName: extras.targetName ?? null,
    ip: clientIp(req),
    details: extras.details ?? null,
  };
  setImmediate(() => {
    try {
      storage.appendAudit(entry);
    } catch (e) {
      console.error("[audit] failed to write entry", e);
    }
  });
}

function parseJson<T>(s: unknown, fallback: T): T {
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

  // ─── Quotes CRUD ──────────────────────────────────────────────────────────

  // List — payload excluded: it's the big JSON blob, and the Saved view only
  // needs the identity columns. GET /:id returns the full row.
  app.get("/api/quotes", requireAuth, (_req, res) => {
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
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
      }).from(quotes)
        .where(isNull(quotes.deletedAt))
        .orderBy(desc(quotes.createdAt), desc(quotes.id))
        .all(),
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
    const to = (typeof req.body?.email === "string" && req.body.email.trim())
      || parseJson<{ customer?: { email?: string } }>(quote.payload, {}).customer?.email
      || "";
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
    }

    audit(req, "quote.share", {
      targetType: "quote", targetId: id, targetName: quote.number,
      details: { emailed, firstShare: quote.status === "draft" },
    });
    res.json({ ok: true, token, url, emailed });
  });
}
