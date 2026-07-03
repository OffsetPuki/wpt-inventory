import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, storage } from "./storage";
import { leads, type LeadSource } from "../shared/crm-schema";
import { campaigns, reviews, portfolioItems } from "../shared/marketing-schema";

// ─── Public API: how www.cjmmetals.com talks to the suite ────────────────────
// Three endpoints, no session auth:
//   POST /api/public/leads      — quote-form intake (shared-secret header)
//   GET  /api/public/reviews    — published testimonials feed
//   GET  /api/public/portfolio  — published "recent work" gallery feed
// The website's server calls these; nothing here is meant for browsers on
// other origins except the two read-only feeds (CORS-opened to the site).

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
