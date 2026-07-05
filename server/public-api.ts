import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite, storage } from "./storage";
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

    const row = db.insert(leads).values({
      name: body.name,
      phone: body.phone || null,
      email: body.email || null,
      source,
      campaignId,
      serviceRequested: body.service || null,
      serviceArea: body.area || null,
      notes: noteLines.join("\n"),
      stage: "new",
    }).returning().get();

    // Configurator designs get their own structured row so the Quote App's
    // "Find design" lookup can serve them. Resubmitting the same code (e.g.
    // the customer edits the design and sends again) updates in place.
    if (body.designRef) {
      sqlite.prepare(`
        INSERT INTO web_designs
          (ref, lead_id, name, phone, email, contact, best_time, service,
           location, consent, source_tool, design_spec, lang)
        VALUES
          (@ref, @leadId, @name, @phone, @email, @contact, @bestTime, @service,
           @location, @consent, @sourceTool, @designSpec, @lang)
        ON CONFLICT(ref) DO UPDATE SET
          lead_id = excluded.lead_id, name = excluded.name,
          phone = excluded.phone, email = excluded.email,
          contact = excluded.contact, best_time = excluded.best_time,
          service = excluded.service, location = excluded.location,
          consent = excluded.consent, source_tool = excluded.source_tool,
          design_spec = excluded.design_spec, lang = excluded.lang
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
          details: { source, campaignId, page: body.page ?? null },
        });
      } catch {
        /* audit is best-effort */
      }
    });

    res.status(201).json({ ok: true, id: row.id });
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
    const configured = process.env.LEAD_INTAKE_KEY;
    // Key rides a query param because that's the protocol the app (and the
    // Apps Script before it) already speaks — HTTPS keeps it out of sight.
    if (!configured || req.query.key !== configured) {
      return res.json({ ok: false, error: "bad key" });
    }

    const rowToLead = (d: any) => ({
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
    });

    const ref = typeof req.query.ref === "string" ? req.query.ref.trim().toUpperCase() : "";
    if (ref) {
      const rows = sqlite.prepare("SELECT * FROM web_designs WHERE upper(ref) = ?").all(ref);
      return res.json({ ok: true, leads: rows.map(rowToLead) });
    }
    const recent = Math.min(Math.max(parseInt(String(req.query.recent ?? "25"), 10) || 25, 1), 100);
    const rows = sqlite.prepare("SELECT * FROM web_designs ORDER BY created_at DESC, id DESC LIMIT ?").all(recent);
    res.json({ ok: true, leads: rows.map(rowToLead) });
  });

  // ─── Read-only public feeds ───────────────────────────────────────────────
  // Small, cacheable, and CORS-open so the site can consume them either from
  // its server (proxy) or directly from the browser.

  const feedHeaders = (res: import("express").Response) => {
    // Overrides the global /api no-store: these are public marketing feeds.
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
  };

  app.get("/api/public/reviews", (_req, res) => {
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

  app.get("/api/public/portfolio", (_req, res) => {
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
