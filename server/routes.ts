import type { Express, Request } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { spawn } from "child_process";
import { storage } from "./storage";
import { requireAuth, requireTechnician, requireElevated, createSession, destroySession } from "./auth";
import { evalQty } from "./expr";
import {
  loginSchema, insertAdjustmentSchema, insertTransactionSchema,
  fromTemplateSchema, CATEGORIES, ROLES, type TemplatePart,
} from "../shared/schema";

const BCRYPT_ROUNDS = 10;

// ── Photo upload via multer ──────────────────────────────────────────────────

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
const uploadDir = path.resolve(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Allowlist of image extensions + mime types we'll accept. JPEG covers the
// downscaled output from the browser; the others let users paste an existing
// PNG/WebP/HEIC without the upload silently failing. PDFs, HTML, JS etc. are
// rejected — otherwise an attacker could upload `evil.html` and have the
// browser render it from this origin, stealing a worker's localStorage token.
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);
const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const rawExt = path.extname(file.originalname).toLowerCase();
      const ext = ALLOWED_IMAGE_EXT.has(rawExt) ? rawExt : ".jpg";
      // 128 bits of crypto-grade randomness so filenames are unguessable
      // even if an attacker can observe the timestamp prefix.
      const rand = crypto.randomBytes(16).toString("hex");
      cb(null, `${Date.now()}-${rand}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_IMAGE_MIME.has(file.mimetype.toLowerCase())) return cb(null, true);
    cb(new Error("Only image uploads are allowed"));
  },
});

// Map a saved upload's extension back to a safe Content-Type so the browser
// can't be tricked into sniffing an uploaded file as HTML/JS.
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

// 5 login attempts per IP per 5 minutes — a 4-digit PIN has only 10k
// combinations, so without a limiter the entire space is brute-forceable in
// seconds. `skipSuccessfulRequests` so a legit user mistyping then succeeding
// doesn't burn through the quota.
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many login attempts — try again in a few minutes." },
});

// Per-account lockout: stronger than IP-based, since an attacker can rotate
// IPs (VPN / Tor) but the username is the target. 10 failures in any window
// lock the account for 15 minutes regardless of where the requests come from.
const ACCOUNT_LOCKOUT_THRESHOLD = 10;
const ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

// Pre-computed bcrypt hash of an impossible PIN — compared against when the
// supplied username doesn't exist, so an attacker can't tell from response
// timing whether a username is real.
const DUMMY_BCRYPT_HASH = bcrypt.hashSync("__nobody__", 10);

// Express's req.ip falls back to the socket address. Behind a proxy
// (Railway / nginx), trust-proxy must be enabled in index.ts so this is
// the real client IP, not the proxy's.
function clientIp(req: Request): string {
  return (req.ip || req.socket?.remoteAddress || "?") as string;
}

function audit(req: Request, action: string, extras: {
  targetType?: string | null;
  targetId?: number | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
} = {}): void {
  storage.appendAudit({
    userId: req.user?.userId ?? null,
    userName: req.user?.name ?? null,
    role: req.user?.role ?? null,
    action,
    targetType: extras.targetType ?? null,
    targetId: extras.targetId ?? null,
    targetName: extras.targetName ?? null,
    ip: clientIp(req),
    details: extras.details ?? null,
  });
}

export function registerRoutes(app: Express): void {
  // ─── Auth ────────────────────────────────────────────────────────────────

  // Express types `req.params.*` as `string | string[]`; narrow to string.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);
  const pkey = (v: string | string[]): string => v as string;

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    let body;
    try {
      body = loginSchema.parse(req.body);
    } catch (e: any) {
      return res.status(400).json({ message: e.message || "Invalid request" });
    }

    const now = Date.now();
    const attempt = storage.getLoginAttempt(body.name);
    if (attempt && attempt.lockedUntil > now) {
      const mins = Math.ceil((attempt.lockedUntil - now) / 60000);
      return res.status(423).json({
        message: `Account temporarily locked — try again in ~${mins} minute(s).`,
      });
    }

    const user = storage.getUserByName(body.name);
    // Always run bcrypt.compare even when the user is unknown, against a
    // dummy hash, so an attacker can't tell from response timing whether
    // a username exists. bcrypt.compare (async) frees the event loop
    // during the ~80ms hash so concurrent logins don't queue behind it.
    const hashToCheck = user ? user.pin : DUMMY_BCRYPT_HASH;
    const matched = await bcrypt.compare(body.pin, hashToCheck);
    const ok = !!user && matched;

    if (!ok) {
      // Only track failures for known usernames — counting bogus usernames
      // would let an attacker DoS by locking out fictional accounts.
      if (user) {
        const r = storage.recordLoginFailure(
          body.name, now, ACCOUNT_LOCKOUT_THRESHOLD, ACCOUNT_LOCKOUT_MS
        );
        storage.appendAudit({
          userId: user.id, userName: user.name, role: user.role,
          action: "auth.login_fail",
          ip: clientIp(req),
          details: { failedCount: r.failedCount, locked: r.lockedUntil > 0 },
        });
        if (r.lockedUntil > 0) {
          return res.status(423).json({
            message: `Too many failed attempts — account locked for ${Math.round(ACCOUNT_LOCKOUT_MS / 60000)} minutes.`,
          });
        }
      }
      return res.status(401).json({ message: "Invalid name or PIN" });
    }

    storage.clearLoginAttempts(body.name);
    const token = createSession(user.id, user.role, user.name);
    storage.appendAudit({
      userId: user.id, userName: user.name, role: user.role,
      action: "auth.login_success", ip: clientIp(req),
    });
    const { pin, ...publicUser } = user;
    res.json({ token, user: publicUser });
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    if (req.user?.token) destroySession(req.user.token);
    audit(req, "auth.logout");
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = storage.getUserById(req.user!.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { pin, ...publicUser } = user;
    res.json(publicUser);
  });

  // The old GET /api/users/list-names was unauthenticated and returned every
  // username on the system. That handed an attacker the first half of every
  // credential pair, so it's been removed; the login form now just lets the
  // user type their name freely.

  // ─── Users (manager-only) ───────────────────────────────────────────────

  app.get("/api/users", requireElevated, (_req, res) => {
    res.json(storage.getUsers());
  });

  app.post("/api/users", requireElevated, (req, res) => {
    try {
      const { name, pin, role } = req.body;
      if (!name || !pin) return res.status(400).json({ message: "Name and PIN required" });
      if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ message: "PIN must be 4 digits" });
      }
      const finalRole = role || "worker";
      if (!ROLES.includes(finalRole)) {
        return res.status(400).json({ message: `Role must be one of: ${ROLES.join(", ")}` });
      }
      if (storage.getUserByName(name)) {
        return res.status(409).json({ message: "User already exists" });
      }
      const user = storage.createUser({
        name,
        pin: bcrypt.hashSync(pin, BCRYPT_ROUNDS),
        role: finalRole,
      });
      audit(req, "user.create", {
        targetType: "user", targetId: user.id, targetName: user.name,
        details: { role: user.role },
      });
      res.status(201).json(user);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/users/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = storage.getUserById(id);
    storage.deleteUser(id);
    audit(req, "user.delete", {
      targetType: "user", targetId: id, targetName: target?.name ?? null,
      details: { role: target?.role ?? null },
    });
    res.json({ ok: true });
  });

  // ─── Items ──────────────────────────────────────────────────────────────

  app.get("/api/items", requireAuth, (req, res) => {
    const items = storage.getItems({
      q: req.query.q as string,
      category: req.query.category as string,
      area: req.query.area as string,
      lowStockOnly: req.query.lowStockOnly === "1",
    });
    res.json(items);
  });

  // Trash listing has to live ABOVE /api/items/:id so the literal "deleted"
  // segment isn't captured as a numeric id parameter.
  app.get("/api/items/deleted", requireTechnician, (_req, res) => {
    res.json(storage.getDeletedItems());
  });

  // Combined item-detail payload: the item + recent transactions + adjustments
  // in one round-trip (replaces 3 separate calls on the item detail page).
  app.get("/api/items/:id/detail", requireAuth, (req, res) => {
    const id = pid(req.params.id);
    const item = storage.getItemById(id);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json({
      item,
      transactions: storage.getTransactions({ itemId: id, limit: 10 }),
      adjustments: storage.getAdjustments(id),
    });
  });

  app.get("/api/items/:id", requireAuth, (req, res) => {
    const item = storage.getItemById(pid(req.params.id));
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.post("/api/items", requireAuth, (req, res) => {
    try {
      const body = { ...req.body };
      // Only technicians may set the low-stock threshold and reserved quantity.
      if (req.user?.role !== "technician") {
        delete body.lowStockThreshold;
        delete body.quantityReserved;
      }
      const item = storage.createItem(body);
      audit(req, "item.create", {
        targetType: "item", targetId: item.id, targetName: item.name,
      });
      res.status(201).json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/items/:id", requireAuth, (req, res) => {
    const item = storage.updateItem(pid(req.params.id), req.body);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.delete("/api/items/:id", requireTechnician, (req, res) => {
    const id = pid(req.params.id);
    const target = storage.getItemById(id);
    storage.deleteItem(id);
    audit(req, "item.delete", {
      targetType: "item", targetId: id, targetName: target?.name ?? null,
    });
    res.json({ ok: true });
  });

  // Restore endpoint for items soft-deleted in the last 30 days. The
  // listing endpoint is registered higher up so /deleted isn't captured
  // as :id by /api/items/:id.
  app.post("/api/items/:id/restore", requireTechnician, (req, res) => {
    const id = pid(req.params.id);
    const target = storage.getItemByIdIncludingDeleted(id);
    if (!target) return res.status(404).json({ message: "Item not found" });
    storage.restoreItem(id);
    audit(req, "item.restore", {
      targetType: "item", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Adjustments ────────────────────────────────────────────────────────

  app.post("/api/items/:id/adjust", requireTechnician, (req, res) => {
    try {
      const data = insertAdjustmentSchema.parse(req.body);
      const id = pid(req.params.id);
      const target = storage.getItemById(id);
      const adj = storage.createAdjustment(id, req.user!.userId, data);
      audit(req, "item.adjust", {
        targetType: "item", targetId: id, targetName: target?.name ?? null,
        details: { delta: data.delta, reason: data.reason },
      });
      res.status(201).json(adj);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/items/:id/adjustments", requireAuth, (req, res) => {
    res.json(storage.getAdjustments(pid(req.params.id)));
  });

  // ─── Check out / Check in ──────────────────────────────────────────────

  app.post("/api/items/:id/checkout", requireAuth, (req, res) => {
    try {
      const data = insertTransactionSchema.parse(req.body);
      const txn = storage.createTransaction(
        pid(req.params.id),
        req.user!.userId,
        "check_out",
        data
      );
      res.status(201).json(txn);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/items/:id/checkin", requireAuth, (req, res) => {
    try {
      const data = insertTransactionSchema.parse(req.body);
      const txn = storage.createTransaction(
        pid(req.params.id),
        req.user!.userId,
        "check_in",
        data
      );
      res.status(201).json(txn);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ─── Transactions ───────────────────────────────────────────────────────

  app.get("/api/transactions", requireAuth, (req, res) => {
    res.json(
      storage.getTransactions({
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        userId: req.query.userId ? parseInt(req.query.userId as string) : undefined,
        itemId: req.query.itemId ? parseInt(req.query.itemId as string) : undefined,
        projectId: req.query.projectId ? parseInt(req.query.projectId as string) : undefined,
      })
    );
  });

  app.get("/api/adjustments", requireAuth, (req, res) => {
    res.json(
      storage.getRecentAdjustments({
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
        userId: req.query.userId ? parseInt(req.query.userId as string) : undefined,
        itemId: req.query.itemId ? parseInt(req.query.itemId as string) : undefined,
      })
    );
  });

  // ─── Projects ───────────────────────────────────────────────────────────

  app.get("/api/projects", requireAuth, (req, res) => {
    res.json(storage.getProjects());
  });

  // Same path-ordering reason as /api/items/deleted: must come before :id.
  app.get("/api/projects/deleted", requireElevated, (_req, res) => {
    res.json(storage.getDeletedProjects());
  });

  app.get("/api/projects/:id", requireAuth, (req, res) => {
    const project = storage.getProjectById(pid(req.params.id));
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.get("/api/projects/:id/usage", requireAuth, (req, res) => {
    res.json(storage.getProjectUsage(pid(req.params.id)));
  });

  app.post("/api/projects", requireElevated, (req, res) => {
    try {
      const project = storage.createProject(req.body);
      audit(req, "project.create", {
        targetType: "project", targetId: project.id, targetName: project.name,
        details: { jobNumber: project.jobNumber },
      });
      res.status(201).json(project);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/projects/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const before = storage.getProjectById(id);
    const project = storage.updateProject(id, req.body);
    if (!project) return res.status(404).json({ message: "Project not found" });
    // Log status changes specifically; other field edits are less interesting.
    if (req.body?.status && before && before.status !== project.status) {
      audit(req, "project.status_change", {
        targetType: "project", targetId: id, targetName: project.name,
        details: { from: before.status, to: project.status },
      });
    }
    res.json(project);
  });

  app.delete("/api/projects/:id", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = storage.getProjectById(id);
    storage.deleteProject(id);
    audit(req, "project.delete", {
      targetType: "project", targetId: id, targetName: target?.name ?? null,
      details: { jobNumber: target?.jobNumber ?? null },
    });
    res.json({ ok: true });
  });

  app.post("/api/projects/:id/restore", requireElevated, (req, res) => {
    const id = pid(req.params.id);
    const target = storage.getProjectByIdIncludingDeleted(id);
    if (!target) return res.status(404).json({ message: "Project not found" });
    storage.restoreProject(id);
    audit(req, "project.restore", {
      targetType: "project", targetId: id, targetName: target.name,
    });
    res.json({ ok: true });
  });

  // ─── Equipment Presets ──────────────────────────────────────────────────

  app.get("/api/equipment-presets", (_req, res) => {
    res.json(storage.getPresets());
  });

  app.post("/api/equipment-presets", requireTechnician, (req, res) => {
    try {
      const preset = storage.createPreset(req.body);
      res.status(201).json(preset);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/equipment-presets/:key", requireTechnician, (req, res) => {
    const preset = storage.updatePreset(pkey(req.params.key), req.body);
    if (!preset) return res.status(404).json({ message: "Preset not found" });
    res.json(preset);
  });

  app.delete("/api/equipment-presets/:key", requireTechnician, (req, res) => {
    storage.deletePreset(pkey(req.params.key));
    res.json({ ok: true });
  });

  // ─── Job Templates ─────────────────────────────────────────────────────

  app.get("/api/job-templates", (_req, res) => {
    res.json(storage.getTemplates());
  });

  app.post("/api/job-templates", requireTechnician, (req, res) => {
    try {
      const tpl = storage.createTemplate(req.body);
      res.status(201).json(tpl);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/job-templates/:key", requireTechnician, (req, res) => {
    const tpl = storage.updateTemplate(pkey(req.params.key), req.body);
    if (!tpl) return res.status(404).json({ message: "Template not found" });
    res.json(tpl);
  });

  app.delete("/api/job-templates/:key", requireTechnician, (req, res) => {
    storage.deleteTemplate(pkey(req.params.key));
    res.json({ ok: true });
  });

  app.post("/api/job-templates/:key/preview", requireTechnician, (req, res) => {
    const tpl = storage.getTemplateByKey(pkey(req.params.key));
    if (!tpl) return res.status(404).json({ message: "Template not found" });

    const parts: TemplatePart[] = JSON.parse(tpl.parts as string);
    const params = req.body.params || {};

    const result = parts.map((part) => ({
      label: part.label,
      qty: evalQty(part.qty, params),
      unit: part.unit,
      equipmentType: part.equipmentType,
      category: part.category,
      notes: part.notes,
    }));

    res.json(result);
  });

  // ─── Project Checklist ──────────────────────────────────────────────────

  app.get("/api/projects/:id/checklist", requireAuth, (req, res) => {
    res.json(storage.getChecklist(pid(req.params.id)));
  });

  app.post("/api/projects/from-template", requireElevated, (req, res) => {
    try {
      const body = fromTemplateSchema.parse(req.body);
      const tpl = storage.getTemplateByKey(body.templateKey);
      if (!tpl) return res.status(404).json({ message: "Template not found" });

      const parts: TemplatePart[] = JSON.parse(tpl.parts as string);

      // Create project — only the user's own notes are stored. The template /
      // params used to be prepended as an "audit block" but that surfaced as a
      // noisy box on the project page (Template: X / Params: ...), so we drop it.
      const project = storage.createProject({
        jobNumber: body.jobNumber,
        name: body.name,
        customer: body.customer,
        notes: body.notes,
      });

      // Evaluate and create checklist rows
      parts.forEach((part, idx) => {
        const qty = evalQty(part.qty, body.params);
        storage.createChecklistRow(project.id, {
          label: part.label,
          qty: String(qty),
          unit: part.unit,
          equipmentType: part.equipmentType,
          category: part.category,
          notes: part.notes,
          orderIndex: idx,
          status: "pending",
        });
      });

      res.status(201).json(project);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/projects/:id/checklist", requireElevated, (req, res) => {
    try {
      const row = storage.createChecklistRow(pid(req.params.id), req.body);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/checklist/:id", requireAuth, (req, res) => {
    // Workers may check items off (status only); manager + technician may edit everything.
    const role = req.user?.role;
    const elevated = role === "manager" || role === "technician";
    const patch = elevated ? req.body : { status: req.body?.status };
    const row = storage.updateChecklistRow(pid(req.params.id), patch);
    if (!row) return res.status(404).json({ message: "Checklist row not found" });
    res.json(row);
  });

  app.delete("/api/checklist/:id", requireElevated, (req, res) => {
    storage.deleteChecklistRow(pid(req.params.id));
    res.json({ ok: true });
  });

  // ─── Settings ──────────────────────────────────────────────────────────

  app.get("/api/settings", (_req, res) => {
    res.json(storage.getSettings());
  });

  app.put("/api/settings", requireTechnician, (req, res) => {
    const s = storage.updateSettings(req.body);
    audit(req, "settings.update", {
      details: { fields: Object.keys(req.body || {}) },
    });
    res.json(s);
  });

  // ─── Audit log ─────────────────────────────────────────────────────────
  // Forensic view of who did what — visible to elevated roles for review.
  app.get("/api/audit-log", requireElevated, (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const action = req.query.action ? String(req.query.action) : undefined;
    const userId = req.query.userId ? parseInt(req.query.userId as string) : undefined;
    res.json(storage.getAuditLog({ limit, action, userId }));
  });

  // ─── Map Layouts ───────────────────────────────────────────────────────

  app.get("/api/map-layouts", (_req, res) => {
    res.json(storage.getMapLayouts());
  });

  app.get("/api/map-layouts/:key", (_req, res) => {
    const layout = storage.getMapLayoutByKey(_req.params.key);
    if (!layout) return res.status(404).json({ message: "Layout not found" });
    res.json(layout);
  });

  app.post("/api/map-layouts", requireTechnician, (req, res) => {
    try {
      const layout = storage.createMapLayout(req.body);
      res.status(201).json(layout);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/map-layouts/:key", requireTechnician, (req, res) => {
    const layout = storage.updateMapLayout(pkey(req.params.key), req.body);
    if (!layout) return res.status(404).json({ message: "Layout not found" });
    res.json(layout);
  });

  app.delete("/api/map-layouts/:key", requireTechnician, (req, res) => {
    storage.deleteMapLayout(pkey(req.params.key));
    res.json({ ok: true });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────

  app.get("/api/stats", requireElevated, (_req, res) => {
    res.json(storage.getStats());
  });

  // ─── Photo upload ──────────────────────────────────────────────────────

  app.post(
    "/api/upload",
    requireAuth,
    (req, res, next) => {
      upload.single("photo")(req, res, (err: any) => {
        if (err) {
          return res.status(400).json({ message: err.message || "Upload rejected" });
        }
        next();
      });
    },
    (req, res) => {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const url = `/uploads/${req.file.filename}`;
      res.json({ url });
    }
  );

  // ─── AI identify ───────────────────────────────────────────────────────
  // Spawns identify_item.py, which calls Claude vision when ANTHROPIC_API_KEY
  // is set and otherwise returns a safe placeholder. Any failure degrades to
  // the placeholder so the form still prefills.

  app.post("/api/ai/identify-item", requireElevated, (req, res) => {
    const fallback = {
      name: "Unidentified Item",
      category: "tools",
      notes: "",
    };

    const photoBase64 = req.body?.photoBase64;
    if (!photoBase64) return res.status(400).json({ message: "photoBase64 required" });

    const input = JSON.stringify({ photoBase64, categories: CATEGORIES });

    const pythonBin = process.env.PYTHON_BIN || (process.platform === "win32" ? "py" : "python3");
    const scriptPath = path.resolve(process.cwd(), "server", "identify_item.py");

    let settled = false;
    const done = (payload: unknown) => {
      if (settled) return;
      settled = true;
      res.json(payload);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(pythonBin, [scriptPath]);
    } catch {
      return done(fallback);
    }

    let out = "";
    let err = "";
    child.on("error", () => done(fallback));
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (err += d.toString()));
    child.on("close", () => {
      if (err.trim()) console.error("[ai/identify]", err.trim());
      if (!process.env.ANTHROPIC_API_KEY) {
        console.warn("[ai/identify] ANTHROPIC_API_KEY not set — returning placeholder.");
      }
      try {
        done(JSON.parse(out.trim()));
      } catch {
        done(fallback);
      }
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done(fallback);
    }, 50000);
    child.on("close", () => clearTimeout(timer));

    child.stdin?.write(input);
    child.stdin?.end();
  });

  // ─── Categorize (heuristic) ────────────────────────────────────────────

  app.post("/api/categorize", requireAuth, (req, res) => {
    const name = (req.body.name || "").toLowerCase();

    const rules: [string[], string][] = [
      [["wire", "cable", "motor", "relay", "contactor", "vfd", "transformer", "breaker", "fuse"], "electric"],
      [["welder", "welding", "mig", "tig", "stick", "electrode", "wire feed"], "welder"],
      [["plc", "hmi", "sensor", "network", "switch", "ethernet", "computer", "monitor", "software"], "it"],
      [["steel", "plate", "tube", "tubing", "pipe", "sheet", "gasket", "seal", "bolt", "nut", "stud", "flange", "fitting"], "raw_materials"],
      [["wrench", "drill", "saw", "hammer", "screwdriver", "pliers", "tool", "tape", "level", "clamp"], "tools"],
    ];

    for (const [keywords, category] of rules) {
      if (keywords.some((kw) => name.includes(kw))) {
        return res.json({ category });
      }
    }

    res.json({ category: "tools" });
  });

  // ─── Serve uploaded files ──────────────────────────────────────────────

  app.use("/uploads", (req, res, next) => {
    // path.basename strips any path traversal (`../`) the client might try.
    const safeName = path.basename(req.path);
    const ext = path.extname(safeName).toLowerCase();
    // Only serve files whose extension we recognise as an image. An unknown
    // extension means either (a) someone bypassed the upload filter, or
    // (b) it's not ours — either way, refuse to serve it.
    const mime = EXT_TO_MIME[ext];
    if (!mime) return next();
    const filePath = path.join(uploadDir, safeName);
    if (!fs.existsSync(filePath)) return next();

    // Force a safe Content-Type and forbid the browser from sniffing the
    // body. Combined, these prevent a malicious upload from being executed
    // as HTML/JS in the same origin as the app — which would otherwise let
    // it read any worker's localStorage token.
    res.setHeader("Content-Type", mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Content-addressed filenames (unique id baked in) never change, so the
    // long immutable cache is safe.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.sendFile(filePath);
  });
}
