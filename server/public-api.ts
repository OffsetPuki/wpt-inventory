import type { Express } from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite, storage } from "./storage";
import { mailEnabled, sendOwnerMail } from "./mailer";
import { leads, type LeadSource } from "../shared/crm-schema";
import { campaigns, reviews, portfolioItems } from "../shared/marketing-schema";

// ─── Public API: how the outside world talks to the suite ────────────────────
// No session auth on any of these:
//   POST /api/public/leads      — quote-form intake (shared-secret header)
//   GET  /api/public/designs    — Quote App "Find design" lookup (shared key)
//   GET  /api/public/reviews    — published testimonials feed
//   GET  /api/public/portfolio  — published "recent work" gallery feed
// The website's server calls the intake; the owner's Quote App (Electron)
// calls the design lookup; the two read-only feeds are CORS-open.

// ─── Website designs (configurator submissions) ──────────────────────────────
// One row per design code (CJM-XXXX) that came through the quote form —
// the structured record behind the Quote App's "Find design" screen, which
// previously read the Google Sheet via Apps Script. Speaks that endpoint's
// exact protocol so the app only needed its lookup URL changed.

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS web_designs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    lead_id INTEGER, -- soft ref to crm_leads (kept if the lead is deleted)
    name TEXT,
    phone TEXT,
    email TEXT,
    contact TEXT,
    best_time TEXT,
    service TEXT,
    location TEXT,
    consent TEXT,
    source_tool TEXT, -- e.g. 'configurator-fence'
    design_spec TEXT,
    lang TEXT NOT NULL DEFAULT 'en',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_web_designs_created ON web_designs(created_at);
`);

// Additive migration: the saved design-preview PNG (an /uploads URL) arrived
// after installs existed. SQLite has no IF NOT EXISTS for columns — the throw
// on re-run is expected.
try {
  sqlite.exec("ALTER TABLE web_designs ADD COLUMN design_png_url TEXT");
} catch {
  /* column already exists */
}

// ─── Design PNG snapshots ────────────────────────────────────────────────────
// The website sends the configurator preview as a data:image/png base64 URL.
// Same uploads dir + filename style as the multer photo flow in routes.ts, so
// the /uploads static handler serves these with no extra wiring.

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
const uploadDir = path.resolve(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Bounds match the website's own guard (~2M chars of base64 ≈ 1.5 MB of PNG).
const MAX_DESIGN_PNG_CHARS = 2_000_000;

// Decode and save; returns the /uploads URL, or null when the field is
// missing, oversized or malformed. NEVER throws — a bad snapshot must not
// cost us the lead it rode in on.
function saveDesignPng(designPng: unknown): string | null {
  if (typeof designPng !== "string" || designPng.length === 0) return null;
  if (designPng.length > MAX_DESIGN_PNG_CHARS) return null;
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(designPng);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    if (buf.length === 0) return null;
    const name = `${Date.now()}-${crypto.randomBytes(16).toString("hex")}.png`;
    fs.writeFileSync(path.join(uploadDir, name), buf);
    return `/uploads/${name}`;
  } catch {
    return null;
  }
}

// ─── Lead intake ─────────────────────────────────────────────────────────────

// The website form (name/phone/email/service/city + message) plus attribution
// context the form controller collects: page path, language, UTM params.
const intakeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().max(200).optional(),
  service: z.string().trim().max(400).optional(),
  area: z.string().trim().max(160).optional(), // city / ZIP
  message: z.string().trim().max(5000).optional(),
  lang: z.enum(["en", "es"]).optional(),
  page: z.string().trim().max(300).optional(),
  utm: z
    .object({
      source: z.string().trim().max(200).optional(),
      medium: z.string().trim().max(200).optional(),
      campaign: z.string().trim().max(200).optional(),
      content: z.string().trim().max(200).optional(),
      term: z.string().trim().max(200).optional(),
    })
    .optional(),
  // Configurator design handoff + contact preferences — structured so the
  // Quote App's design lookup can serve them field-for-field.
  designRef: z.string().trim().max(40).optional(),
  designSource: z.string().trim().max(100).optional(),
  designSpec: z.string().trim().max(8000).optional(),
  contact: z.string().trim().max(60).optional(),
  bestTime: z.string().trim().max(120).optional(),
  consent: z.string().trim().max(10).optional(),
  // PNG snapshot of the configurator preview ('data:image/png;base64,…').
  // Deliberately unvalidated here: an oversized/malformed snapshot is ignored
  // by saveDesignPng, never a reason to reject the lead itself.
  designPng: z.unknown().optional(),
});

// Map a UTM source onto the CRM's lead-source enum. Anything we can't place
// confidently stays "website" — the form itself is the source of truth, the
// UTM just sharpens it (and the raw string is preserved in the notes).
function mapSource(utmSource: string | undefined): LeadSource {
  const s = (utmSource ?? "").toLowerCase();
  if (s.includes("facebook") || s === "fb") return "facebook";
  if (s.includes("instagram") || s === "ig") return "instagram";
  return "website";
}

// Case-insensitive campaign-name match links the lead to a Marketing campaign
// so CPL / revenue-by-campaign reporting works without manual tagging.
function findCampaignId(utmCampaign: string | undefined): number | null {
  if (!utmCampaign) return null;
  const row = db.select({ id: campaigns.id }).from(campaigns)
    .where(and(
      isNull(campaigns.deletedAt),
      sql`lower(${campaigns.name}) = ${utmCampaign.toLowerCase()}`,
    ))
    .get();
  return row?.id ?? null;
}

// Near-duplicate suppression: the same person double-clicking submit, or
// fixing a typo and sending again within 10 minutes, should fold into the
// lead they just created — not clutter the pipeline with copies. Match on
// normalized email OR digits-only phone (both only when non-empty on BOTH
// sides). The 10-minute window is tiny, so matching in JS is fine.
function findRecentDuplicate(
  email: string | undefined,
  phone: string | undefined,
): typeof leads.$inferSelect | undefined {
  const emailNorm = (email ?? "").trim().toLowerCase();
  const phoneDigits = (phone ?? "").replace(/\D/g, "");
  if (!emailNorm && !phoneDigits) return undefined;
  const cutoff = Date.now() - 10 * 60 * 1000;
  return db.select().from(leads)
    .where(and(isNull(leads.deletedAt), sql`${leads.createdAt} >= ${cutoff}`))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .all()
    .find((l) => {
      const lEmail = (l.email ?? "").trim().toLowerCase();
      const lPhone = (l.phone ?? "").replace(/\D/g, "");
      return (!!emailNorm && !!lEmail && lEmail === emailNorm)
        || (!!phoneDigits && !!lPhone && lPhone === phoneDigits);
    });
}

// Append an /uploads URL to a lead's photos column (JSON string[]). A corrupt
// value starts a fresh array rather than throwing away the new photo.
function appendLeadPhoto(leadId: number, url: string): void {
  const row = db.select({ photos: leads.photos }).from(leads)
    .where(eq(leads.id, leadId)).get();
  let arr: string[] = [];
  try {
    const parsed = JSON.parse(row?.photos || "[]");
    if (Array.isArray(parsed)) arr = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    /* start fresh */
  }
  arr.push(url);
  db.update(leads).set({ photos: JSON.stringify(arr) }).where(eq(leads.id, leadId)).run();
}

// A web_designs row in the lead envelope the Quote App's fetchLeads expects —
// shared with the authenticated lookup in quotes.ts (the embedded builder).
export function webDesignRowToLead(d: any) {
  return {
    time: new Date(d.created_at).toISOString(),
    type: "lead",
    ref: d.ref,
    name: d.name ?? "",
    phone: d.phone ?? "",
    email: d.email ?? "",
    contact: d.contact ?? "",
    bestTime: d.best_time ?? "",
    service: d.service ?? "",
    location: d.location ?? "",
    consent: d.consent ?? "",
    source: d.source_tool ?? "",
    designSpec: d.design_spec ?? "",
    notes: "",
    lang: d.lang ?? "en",
  };
}

// The website's server authenticates its proxy calls with the shared
// X-Lead-Key header. Those calls funnel every visitor through one egress IP,
// so per-IP limits would hand the whole site a single hourly bucket — keyed
// requests skip the public limiters instead (the site throttles per visitor).
export function hasLeadKey(req: import("express").Request): boolean {
  const configured = process.env.LEAD_INTAKE_KEY;
  return !!configured && req.headers["x-lead-key"] === configured;
}

// 30 submissions per IP per hour — far above any legitimate visitor, low
// enough that a runaway bot can't flood the pipeline. The site also keeps its
// own honeypot in front of this.
const intakeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many submissions — try again later." },
});

export function registerPublicRoutes(app: Express): void {
  app.post("/api/public/leads", intakeLimiter, (req, res) => {
    // Shared secret: the website's server sends X-Lead-Key. Unset env means
    // the pipe is intentionally closed (e.g. local dev) — 503, not 401, so
    // the site's failover logs make the difference obvious.
    const configured = process.env.LEAD_INTAKE_KEY;
    if (!configured) {
      return res.status(503).json({ message: "Lead intake not configured (LEAD_INTAKE_KEY unset)" });
    }
    if (req.headers["x-lead-key"] !== configured) {
      return res.status(401).json({ message: "Bad intake key" });
    }

    let body;
    try {
      body = intakeSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }

    const source = mapSource(body.utm?.source);
    const campaignId = findCampaignId(body.utm?.campaign);
    // Design-preview snapshot → /uploads file. Null when absent or unusable —
    // never a reason to reject the lead.
    const pngUrl = saveDesignPng(body.designPng);

    // Everything that doesn't have a column lands in notes, so no context the
    // form captured is ever lost.
    const noteLines = [
      body.message,
      "—",
      `From cjmmetals.com${body.page ?? ""}${body.lang === "es" ? " (Español)" : ""}`,
      body.utm && Object.values(body.utm).some(Boolean)
        ? `UTM: ${Object.entries(body.utm)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}`
        : null,
    ].filter(Boolean);

    // Resubmit within 10 minutes → annotate the existing lead instead of
    // inserting a copy. The design row, PNG and response still flow as usual;
    // only the duplicate pipeline entry (and a second owner email) are spared.
    const dupe = findRecentDuplicate(body.email, body.phone);
    let row: typeof leads.$inferSelect;
    if (dupe) {
      const resubmit = [`Resubmitted ${new Date().toISOString()}`, body.message]
        .filter(Boolean)
        .join("\n");
      // The resubmission is the freshest copy of the contact card — a customer
      // fixing a typo'd phone or email two minutes later must actually land
      // the fix, not have it vanish into a note. Empty fields never blank out
      // a stored value.
      row = db.update(leads)
        .set({
          name: body.name || dupe.name,
          phone: body.phone || dupe.phone,
          email: body.email || dupe.email,
          serviceRequested: body.service || dupe.serviceRequested,
          serviceArea: body.area || dupe.serviceArea,
          notes: dupe.notes ? `${dupe.notes}\n${resubmit}` : resubmit,
        })
        .where(eq(leads.id, dupe.id))
        .returning()
        .get();
    } else {
      row = db.insert(leads).values({
        name: body.name,
        phone: body.phone || null,
        email: body.email || null,
        source,
        campaignId,
        serviceRequested: body.service || null,
        serviceArea: body.area || null,
        // Raw UTM strings get real columns for the attribution report; the
        // notes line above keeps the full set (content/term included).
        utmSource: body.utm?.source || null,
        utmMedium: body.utm?.medium || null,
        utmCampaign: body.utm?.campaign || null,
        notes: noteLines.join("\n"),
        stage: "new",
      }).returning().get();
    }

    // The saved snapshot doubles as the lead's first photo — it shows up in
    // the CRM photo strip like any shop-floor upload.
    if (pngUrl) appendLeadPhoto(row.id, pngUrl);

    // Configurator designs get their own structured row so the Quote App's
    // "Find design" lookup can serve them. Resubmitting the same code (e.g.
    // the customer edits the design and sends again) updates in place.
    if (body.designRef) {
      sqlite.prepare(`
        INSERT INTO web_designs
          (ref, lead_id, name, phone, email, contact, best_time, service,
           location, consent, source_tool, design_spec, design_png_url, lang)
        VALUES
          (@ref, @leadId, @name, @phone, @email, @contact, @bestTime, @service,
           @location, @consent, @sourceTool, @designSpec, @designPngUrl, @lang)
        ON CONFLICT(ref) DO UPDATE SET
          lead_id = excluded.lead_id, name = excluded.name,
          phone = excluded.phone, email = excluded.email,
          contact = excluded.contact, best_time = excluded.best_time,
          service = excluded.service, location = excluded.location,
          consent = excluded.consent, source_tool = excluded.source_tool,
          design_spec = excluded.design_spec,
          -- A resubmit without a snapshot keeps the one we already saved.
          design_png_url = COALESCE(excluded.design_png_url, design_png_url),
          lang = excluded.lang
      `).run({
        ref: body.designRef.toUpperCase(),
        leadId: row.id,
        name: body.name,
        phone: body.phone ?? null,
        email: body.email ?? null,
        contact: body.contact ?? null,
        bestTime: body.bestTime ?? null,
        service: body.service ?? null,
        location: body.area ?? null,
        consent: body.consent ?? null,
        sourceTool: body.designSource ?? null,
        designSpec: body.designSpec ?? null,
        designPngUrl: pngUrl,
        lang: body.lang ?? "en",
      });
    }

    setImmediate(() => {
      try {
        storage.appendAudit({
          userId: null,
          userName: "cjmmetals.com",
          role: null,
          action: "crm.lead_intake",
          targetType: "lead",
          targetId: row.id,
          targetName: row.name,
          ip: req.ip ?? null,
          details: { source, campaignId, page: body.page ?? null, deduped: !!dupe },
        });
      } catch {
        /* audit is best-effort */
      }
    });

    // Owner heads-up — deferred off the response path like the audit write.
    // Resubmits stay quiet (the first submission already emailed), and an
    // unconfigured mailer skips silently.
    if (!dupe && mailEnabled()) {
      const text =
        `New quote request from cjmmetals.com\n\n` +
        `Name:      ${body.name}\n` +
        `Phone:     ${body.phone || "(not given)"}\n` +
        `Email:     ${body.email || "(not given)"}\n` +
        `Contact:   ${body.contact || "(no preference)"}${body.bestTime ? " — best time: " + body.bestTime : ""}\n` +
        `Service:   ${body.service || "(not given)"}\n` +
        `Location:  ${body.area || "(not given)"}\n` +
        `Consent:   ${body.consent === "yes" ? "agreed to call/text" : "NOT given"}\n` +
        (body.designRef ? `Design:    ${body.designRef} (${body.designSource || "configurator"})\n` : "") +
        (pngUrl ? `Snapshot:  ${pngUrl}\n` : "") +
        (body.designSpec ? `\nDesign spec:\n${body.designSpec}\n` : "") +
        `\nNotes:\n${body.message || "(none)"}\n` +
        `\nLang: ${body.lang ?? "en"} · Page: ${body.page || "?"} · Lead #${row.id}`;
      setImmediate(() => {
        void sendOwnerMail({
          subject: `[CJM Suite] New website lead — ${body.name}`,
          text,
        });
      });
    }

    res.status(201).json(
      dupe ? { ok: true, id: row.id, deduped: true } : { ok: true, id: row.id },
    );
  });

  // ─── Quote App design lookup ──────────────────────────────────────────────
  // Drop-in replacement for the Apps Script doGet the Electron Quote App was
  // built against — same query params (?key=…&ref=… / &recent=N), same
  // response envelope ({ ok, leads: [...] } / { ok: false, error: 'bad key' }),
  // so migrating the app is just changing its lookup URL in Settings.

  const designLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120, // the owner clicking around the Find design screen, not a feed
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "rate limited" },
  });

  app.get("/api/public/designs", designLimiter, (req, res) => {
    // CORS-open like the Apps Script before it — the Electron app's renderer
    // runs off file:// and can't read the response otherwise. The shared key
    // still gates the data; the header only lets the reply through.
    res.setHeader("Access-Control-Allow-Origin", "*");
    const configured = process.env.LEAD_INTAKE_KEY;
    // Key rides a query param because that's the protocol the app (and the
    // Apps Script before it) already speaks. Query strings land in proxy and
    // access logs, though, so an X-Lead-Key header is accepted too — callers
    // can move off the query param without a protocol break.
    // ponytail: query-param key kept for Quote App compat; retire it when the
    // app ships a header-sending release.
    const provided = req.headers["x-lead-key"] ?? req.query.key;
    if (!configured || provided !== configured) {
      return res.json({ ok: false, error: "bad key" });
    }

    const ref = typeof req.query.ref === "string" ? req.query.ref.trim().toUpperCase() : "";
    if (ref) {
      const rows = sqlite.prepare("SELECT * FROM web_designs WHERE upper(ref) = ?").all(ref);
      return res.json({ ok: true, leads: rows.map(webDesignRowToLead) });
    }
    const recent = Math.min(Math.max(parseInt(String(req.query.recent ?? "25"), 10) || 25, 1), 100);
    const rows = sqlite.prepare("SELECT * FROM web_designs ORDER BY created_at DESC, id DESC LIMIT ?").all(recent);
    res.json({ ok: true, leads: rows.map(webDesignRowToLead) });
  });

  // ─── Read-only public feeds ───────────────────────────────────────────────
  // Small, cacheable, and CORS-open so the site can consume them either from
  // its server (proxy) or directly from the browser.

  const feedHeaders = (res: import("express").Response) => {
    // Overrides the global /api no-store: these are public marketing feeds.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
  };

  // The 5-minute cache absorbs legitimate traffic; this only guards
  // cache-busting bursts, and the keyed website server is never throttled.
  const feedLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip: hasLeadKey,
    message: { message: "rate limited" },
  });

  app.get("/api/public/reviews", feedLimiter, (_req, res) => {
    feedHeaders(res);
    res.json({
      reviews: db.select({
        author: reviews.author,
        rating: reviews.rating,
        text: reviews.text,
        source: reviews.source,
        date: reviews.reviewDate,
      })
        .from(reviews)
        .where(eq(reviews.published, true))
        .orderBy(desc(reviews.reviewDate), desc(reviews.id))
        .limit(50)
        .all(),
    });
  });

  app.get("/api/public/portfolio", feedLimiter, (_req, res) => {
    feedHeaders(res);
    res.json({
      items: db.select({
        title: portfolioItems.title,
        category: portfolioItems.category,
        photoUrl: portfolioItems.photoUrl,
      })
        .from(portfolioItems)
        .where(eq(portfolioItems.published, true))
        .orderBy(asc(portfolioItems.orderIndex), desc(portfolioItems.createdAt))
        .limit(60)
        .all(),
    });
  });
}
