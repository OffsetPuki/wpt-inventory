import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { storage } from "./storage";
import { requireAuth, requireManager, createSession, destroySession } from "./auth";
import { evalQty } from "./expr";
import {
  loginSchema, insertAdjustmentSchema, insertTransactionSchema,
  fromTemplateSchema, CATEGORIES, type TemplatePart, type TemplateParam,
} from "../shared/schema";

// ── Photo upload via multer ──────────────────────────────────────────────────

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), "data");
const uploadDir = path.resolve(dataDir, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

export function registerRoutes(app: Express): void {
  // ─── Auth ────────────────────────────────────────────────────────────────

  // Express types `req.params.*` as `string | string[]`; narrow to string.
  const pid = (v: string | string[]): number => parseInt(v as string, 10);
  const pkey = (v: string | string[]): string => v as string;

  app.post("/api/auth/login", (req, res) => {
    try {
      const body = loginSchema.parse(req.body);
      const user = storage.getUserByName(body.name);
      if (!user || user.pin !== body.pin) {
        return res.status(401).json({ message: "Invalid name or PIN" });
      }
      const token = createSession(user.id, user.role, user.name);
      const { pin, ...publicUser } = user;
      res.json({ token, user: publicUser });
    } catch (e: any) {
      res.status(400).json({ message: e.message || "Invalid request" });
    }
  });

  app.post("/api/auth/logout", requireAuth, (req, res) => {
    if (req.user?.token) destroySession(req.user.token);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = storage.getUserById(req.user!.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { pin, ...publicUser } = user;
    res.json(publicUser);
  });

  app.get("/api/users/list-names", (_req, res) => {
    res.json(storage.listUserNames());
  });

  // ─── Users (manager-only) ───────────────────────────────────────────────

  app.get("/api/users", requireManager, (_req, res) => {
    res.json(storage.getUsers());
  });

  app.post("/api/users", requireManager, (req, res) => {
    try {
      const { name, pin, role } = req.body;
      if (!name || !pin) return res.status(400).json({ message: "Name and PIN required" });
      if (storage.getUserByName(name)) {
        return res.status(409).json({ message: "User already exists" });
      }
      const user = storage.createUser({ name, pin, role: role || "worker" });
      res.status(201).json(user);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/users/:id", requireManager, (req, res) => {
    storage.deleteUser(pid(req.params.id));
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

  app.get("/api/items/duplicates", requireAuth, (req, res) => {
    const items = storage.getItemDuplicates(
      req.query.name as string,
      req.query.category as string
    );
    res.json(items);
  });

  app.get("/api/items/:id", requireAuth, (req, res) => {
    const item = storage.getItemById(pid(req.params.id));
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.post("/api/items", requireAuth, (req, res) => {
    try {
      const body = { ...req.body };
      // Only managers may set the low-stock threshold and reserved quantity.
      if (req.user?.role !== "manager") {
        delete body.lowStockThreshold;
        delete body.quantityReserved;
      }
      const item = storage.createItem(body);
      res.status(201).json(item);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/items/:id", requireManager, (req, res) => {
    const item = storage.updateItem(pid(req.params.id), req.body);
    if (!item) return res.status(404).json({ message: "Item not found" });
    res.json(item);
  });

  app.delete("/api/items/:id", requireManager, (req, res) => {
    storage.deleteItem(pid(req.params.id));
    res.json({ ok: true });
  });

  // ─── Adjustments ────────────────────────────────────────────────────────

  app.post("/api/items/:id/adjust", requireManager, (req, res) => {
    try {
      const data = insertAdjustmentSchema.parse(req.body);
      const adj = storage.createAdjustment(
        pid(req.params.id),
        req.user!.userId,
        data
      );
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

  app.get("/api/projects/:id", requireAuth, (req, res) => {
    const project = storage.getProjectById(pid(req.params.id));
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.get("/api/projects/:id/usage", requireAuth, (req, res) => {
    res.json(storage.getProjectUsage(pid(req.params.id)));
  });

  app.post("/api/projects", requireManager, (req, res) => {
    try {
      const project = storage.createProject(req.body);
      res.status(201).json(project);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/projects/:id", requireManager, (req, res) => {
    const project = storage.updateProject(pid(req.params.id), req.body);
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  });

  app.delete("/api/projects/:id", requireManager, (req, res) => {
    storage.deleteProject(pid(req.params.id));
    res.json({ ok: true });
  });

  // ─── Equipment Presets ──────────────────────────────────────────────────

  app.get("/api/equipment-presets", (_req, res) => {
    res.json(storage.getPresets());
  });

  app.post("/api/equipment-presets", requireManager, (req, res) => {
    try {
      const preset = storage.createPreset(req.body);
      res.status(201).json(preset);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/equipment-presets/:key", requireManager, (req, res) => {
    const preset = storage.updatePreset(pkey(req.params.key), req.body);
    if (!preset) return res.status(404).json({ message: "Preset not found" });
    res.json(preset);
  });

  app.delete("/api/equipment-presets/:key", requireManager, (req, res) => {
    storage.deletePreset(pkey(req.params.key));
    res.json({ ok: true });
  });

  // ─── Job Templates ─────────────────────────────────────────────────────

  app.get("/api/job-templates", (_req, res) => {
    res.json(storage.getTemplates());
  });

  app.post("/api/job-templates", requireManager, (req, res) => {
    try {
      const tpl = storage.createTemplate(req.body);
      res.status(201).json(tpl);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/job-templates/:key", requireManager, (req, res) => {
    const tpl = storage.updateTemplate(pkey(req.params.key), req.body);
    if (!tpl) return res.status(404).json({ message: "Template not found" });
    res.json(tpl);
  });

  app.delete("/api/job-templates/:key", requireManager, (req, res) => {
    storage.deleteTemplate(pkey(req.params.key));
    res.json({ ok: true });
  });

  app.post("/api/job-templates/:key/preview", requireManager, (req, res) => {
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

  app.post("/api/projects/from-template", requireManager, (req, res) => {
    try {
      const body = fromTemplateSchema.parse(req.body);
      const tpl = storage.getTemplateByKey(body.templateKey);
      if (!tpl) return res.status(404).json({ message: "Template not found" });

      const parts: TemplatePart[] = JSON.parse(tpl.parts as string);
      const tplParams: TemplateParam[] = JSON.parse(tpl.params as string);

      // Build audit trail note
      const paramStr = Object.entries(body.params)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ");
      const auditBlock = `Template: ${tpl.label}\nParams: ${paramStr}`;
      const notes = body.notes
        ? `${auditBlock}\n${body.notes}`
        : auditBlock;

      // Create project
      const project = storage.createProject({
        jobNumber: body.jobNumber,
        name: body.name,
        customer: body.customer,
        notes,
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

  app.post("/api/projects/:id/checklist", requireManager, (req, res) => {
    try {
      const row = storage.createChecklistRow(pid(req.params.id), req.body);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/checklist/:id", requireAuth, (req, res) => {
    // Workers may check items off (status only); managers may edit everything.
    const patch =
      req.user?.role === "manager" ? req.body : { status: req.body?.status };
    const row = storage.updateChecklistRow(pid(req.params.id), patch);
    if (!row) return res.status(404).json({ message: "Checklist row not found" });
    res.json(row);
  });

  app.delete("/api/checklist/:id", requireManager, (req, res) => {
    storage.deleteChecklistRow(pid(req.params.id));
    res.json({ ok: true });
  });

  // ─── Settings ──────────────────────────────────────────────────────────

  app.get("/api/settings", (_req, res) => {
    res.json(storage.getSettings());
  });

  app.put("/api/settings", requireManager, (req, res) => {
    const s = storage.updateSettings(req.body);
    res.json(s);
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

  app.post("/api/map-layouts", requireManager, (req, res) => {
    try {
      const layout = storage.createMapLayout(req.body);
      res.status(201).json(layout);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.put("/api/map-layouts/:key", requireManager, (req, res) => {
    const layout = storage.updateMapLayout(pkey(req.params.key), req.body);
    if (!layout) return res.status(404).json({ message: "Layout not found" });
    res.json(layout);
  });

  app.delete("/api/map-layouts/:key", requireManager, (req, res) => {
    storage.deleteMapLayout(pkey(req.params.key));
    res.json({ ok: true });
  });

  // ─── Stats ─────────────────────────────────────────────────────────────

  app.get("/api/stats", requireManager, (_req, res) => {
    res.json(storage.getStats());
  });

  // ─── Photo upload ──────────────────────────────────────────────────────

  app.post("/api/upload", requireAuth, upload.single("photo"), (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
  });

  // ─── AI identify ───────────────────────────────────────────────────────
  // Spawns identify_item.py, which calls Claude vision when ANTHROPIC_API_KEY
  // is set and otherwise returns a safe placeholder. Any failure degrades to
  // the placeholder so the form still prefills.

  app.post("/api/ai/identify-item", requireManager, (req, res) => {
    const fallback = {
      name: "Unidentified Item",
      category: "tools",
      equipmentType: null,
      customAttrs: {},
      partNumber: null,
    };

    const photoBase64 = req.body?.photoBase64;
    if (!photoBase64) return res.status(400).json({ message: "photoBase64 required" });

    const equipmentTypes = storage
      .getPresets()
      .filter((p) => p.enabled)
      .map((p) => ({ key: p.key, label: p.label }));
    const input = JSON.stringify({ photoBase64, categories: CATEGORIES, equipmentTypes });

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
    child.on("error", () => done(fallback));
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.on("close", () => {
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
    const filePath = path.join(uploadDir, path.basename(req.path));
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }
    next();
  });
}
